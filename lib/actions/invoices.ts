'use server'

import { eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { startOfMonth, format } from 'date-fns'
import { db } from '@/db'
import { invoices, orders } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/validators/uuid'
import { DB_DATE_FORMAT } from '@/lib/dates'
import { INVOICE_EXISTS_CODE } from './invoices.constants'

// User-facing fallback for any server-side failure that isn't a validation,
// auth, or business-rule rejection. Detailed cause is logged server-side via
// console.error — never surfaced to the client (SEC-05, EH-04).
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'

// Invoice number format: INV-0001, INV-0002, … padded to 4 digits.
const INVOICE_NUMBER_PREFIX = 'INV-'
const INVOICE_NUMBER_PAD = 4
const INVOICE_NUMBER_SUFFIX_START = INVOICE_NUMBER_PREFIX.length + 1

// Defense-in-depth cap on the orderIds array.
const ORDER_IDS_MAX = 500

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const createInvoiceInputSchema = z.object({
  billingMonth: z.date(),
  orderIds: z
    .array(z.string().regex(UUID_RE, 'Invalid order id.'))
    .min(1, 'Select at least one order.')
    .max(ORDER_IDS_MAX, `Select at most ${ORDER_IDS_MAX} orders per invoice.`),
  // When true, an existing invoice for `billingMonth` is deleted first
  // (its orders detach back to status='completed') and the new invoice
  // takes its place with a fresh INV-#### number.
  overwrite: z.boolean().optional().default(false),
})

export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.'
}

async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { error: 'You are not signed in.' }
  return null
}

async function nextInvoiceNumber(tx: Tx): Promise<string> {
  // Embed the suffix-start position via `sql.raw` — see the long comment in
  // git history for why a bound parameter triggered Postgres's regex
  // SUBSTRING overload and broke the MAX once any invoice number contained
  // a digit '5'. Constant value, no SQL-injection concern.
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(invoice_number FROM ${sql.raw(String(INVOICE_NUMBER_SUFFIX_START))}) AS INTEGER)),
      0
    ) AS max_num
    FROM invoices
  `)) as unknown as { max_num: number | string }[]
  const currentMax = Number(rows[0]?.max_num ?? 0)
  const next = currentMax + 1
  return `${INVOICE_NUMBER_PREFIX}${String(next).padStart(INVOICE_NUMBER_PAD, '0')}`
}

interface OrderRow {
  id: string
  po_number: string
  status: string
  invoice_id: string | null
  price: string
}

function findIneligibleOrder(rows: OrderRow[]): OrderRow | null {
  return rows.find((row) => row.status !== 'completed' || row.invoice_id !== null) ?? null
}

function sumPrices(rows: OrderRow[]): string {
  // `price` arrives as a numeric-column string. Sum in cents via integer
  // math to avoid floating-point drift, then render back to a two-decimal
  // string for Drizzle's numeric insert.
  const totalCents = rows.reduce((acc, row) => acc + Math.round(Number(row.price) * 100), 0)
  return (totalCents / 100).toFixed(2)
}

interface ExistingMonthInvoice {
  id: string
  invoice_number: string
}

async function existingInvoiceForMonth(
  tx: Tx,
  billingMonthIso: string,
): Promise<ExistingMonthInvoice | null> {
  const rows = (await tx.execute(sql`
    SELECT id, invoice_number FROM invoices
    WHERE billing_month = ${billingMonthIso}
    LIMIT 1
  `)) as unknown as ExistingMonthInvoice[]
  return rows[0] ?? null
}

async function deleteExistingInvoiceAndDetachOrders(tx: Tx, invoiceId: string): Promise<void> {
  // Orders attached to the invoice flip back to 'completed' so they're
  // eligible for re-invoicing. The invoices row is then dropped — the FK on
  // `orders.invoice_id` is `set null`, so Postgres clears the column for
  // any orders we missed (defensive).
  await tx
    .update(orders)
    .set({ status: 'completed', invoice_id: null, updated_at: new Date() })
    .where(eq(orders.invoice_id, invoiceId))
  await tx.delete(invoices).where(eq(invoices.id, invoiceId))
}

async function runCreateInvoiceTransaction(
  tx: Tx,
  data: { billingMonth: Date; orderIds: string[]; overwrite: boolean },
): Promise<
  | { id: string; invoiceNumber: string }
  | { code: typeof INVOICE_EXISTS_CODE; existingInvoiceNumber: string }
  | { error: string }
> {
  const billingMonthIso = format(startOfMonth(data.billingMonth), DB_DATE_FORMAT)

  const existing = await existingInvoiceForMonth(tx, billingMonthIso)
  if (existing && !data.overwrite) {
    return { code: INVOICE_EXISTS_CODE, existingInvoiceNumber: existing.invoice_number }
  }
  if (existing && data.overwrite) {
    await deleteExistingInvoiceAndDetachOrders(tx, existing.id)
  }

  // Lock the orders for the life of the tx to block concurrent invoicing.
  const rows = (await tx
    .select({
      id: orders.id,
      po_number: orders.po_number,
      status: orders.status,
      invoice_id: orders.invoice_id,
      price: orders.price,
    })
    .from(orders)
    .where(inArray(orders.id, data.orderIds))
    .for('update')) as OrderRow[]

  if (rows.length !== data.orderIds.length) {
    return { error: 'One or more orders could not be found.' }
  }

  const ineligible = findIneligibleOrder(rows)
  if (ineligible) {
    return { error: `Order ${ineligible.po_number} is already invoiced.` }
  }

  const invoiceNumber = await nextInvoiceNumber(tx)

  const [inserted] = await tx
    .insert(invoices)
    .values({
      invoice_number: invoiceNumber,
      billing_month: billingMonthIso,
      total_amount: sumPrices(rows),
    })
    .returning({ id: invoices.id })

  await tx
    .update(orders)
    .set({ status: 'invoiced', invoice_id: inserted.id, updated_at: new Date() })
    .where(inArray(orders.id, data.orderIds))

  return { id: inserted.id, invoiceNumber }
}

/**
 * Creates a draft invoice from the selected completed orders in one atomic
 * DB transaction. v3:
 *  - One invoice per (calendar) month covering all customers' POs. The
 *    salesperson never picks a customer; eligible orders span the whole
 *    month across every customer (CONSTRAINT-17).
 *  - When an invoice already exists for the requested month and `overwrite`
 *    is false, the action returns
 *    `{ code: 'INVOICE_EXISTS', existingInvoiceNumber }` — the client
 *    surfaces an overwrite modal and re-calls with `overwrite: true`.
 *  - When `overwrite` is true, the existing invoice is deleted (its orders
 *    detach back to `status='completed'`) and a new INV-#### takes its
 *    place. Number reuse is acceptable for an internal draft-only invoice
 *    system — the deleted invoice's number is retired with the row.
 *  - Re-validates every orderId server-side: if any order is no longer
 *    completed or already attached to a (different) invoice, the whole
 *    operation rolls back.
 */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<
  | { id: string; invoiceNumber: string }
  | { code: typeof INVOICE_EXISTS_CODE; existingInvoiceNumber: string }
  | { error: string }
> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  const parsed = createInvoiceInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const result = await db.transaction((tx) =>
      runCreateInvoiceTransaction(tx, {
        billingMonth: parsed.data.billingMonth,
        orderIds: parsed.data.orderIds,
        overwrite: parsed.data.overwrite,
      }),
    )
    if ('error' in result || 'code' in result) return result
    revalidatePath('/invoices')
    revalidatePath('/orders')
    return result
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      (cause as { code?: unknown }).code === '23505'
    ) {
      console.error('createInvoice: invoice_number collision', { cause })
      return { error: 'Invoice number collision — please try again.' }
    }
    console.error('createInvoice: transaction failed', { cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
