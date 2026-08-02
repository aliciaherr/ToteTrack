import { sql, type SQL } from 'drizzle-orm'
import { startOfMonth, endOfMonth, format } from 'date-fns'
import { db } from '@/db'
import { DatabaseError, InvoiceNotFoundError } from '@/lib/errors'
import { DB_DATE_FORMAT } from '@/lib/dates'

export interface InvoiceableOrder {
  id: string
  po_number: string
  customer_id: string
  customer_name: string | null
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
  requested_delivery_date: string | null
}

export interface InvoiceLedgerRow {
  id: string
  invoice_number: string
  billing_month: string
  total_amount: string
}

export interface InvoicePoRow {
  id: string
  po_number: string
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
  customer_name: string | null
  backhaul: boolean
}

export interface InvoiceDetail {
  id: string
  invoice_number: string
  billing_month: string
  total_amount: string
  created_at: string
  po_rows: InvoicePoRow[]
}

function buildInvoiceableOrdersQuery(monthStart: string, monthEnd: string): SQL {
  return sql`
    SELECT
      o.id,
      o.po_number,
      o.customer_id,
      c.company_name AS customer_name,
      o.qty_275_recon,
      o.qty_275_rebot,
      o.qty_275_new,
      o.qty_330_recon,
      o.qty_330_rebot,
      o.qty_330_new,
      o.price::text AS price,
      o.requested_delivery_date
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'completed'
      AND o.invoice_id IS NULL
      AND o.requested_delivery_date >= ${monthStart}
      AND o.requested_delivery_date <= ${monthEnd}
    ORDER BY o.requested_delivery_date ASC NULLS LAST, o.po_number ASC
  `
}

/**
 * Returns completed, uninvoiced orders whose `requested_delivery_date` falls
 * within the calendar month of `billingMonth`. v3: no per-customer filter —
 * one invoice per month covers every eligible PO across all customers
 * (CONSTRAINT-17). Each row joins the customer's company name so the
 * generator panel can render it without a second round-trip.
 *
 * Returns `[]` when no orders match — callers render the
 * "No completed orders for this period." empty state.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getInvoiceableOrders(billingMonth: Date): Promise<InvoiceableOrder[]> {
  const monthStart = format(startOfMonth(billingMonth), DB_DATE_FORMAT)
  const monthEnd = format(endOfMonth(billingMonth), DB_DATE_FORMAT)

  try {
    const result = await db.execute(buildInvoiceableOrdersQuery(monthStart, monthEnd))
    return result as unknown as InvoiceableOrder[]
  } catch (cause) {
    console.error('getInvoiceableOrders: query failed', {
      operation: 'getInvoiceableOrders',
      monthStart,
      monthEnd,
      cause,
    })
    throw new DatabaseError(
      'getInvoiceableOrders',
      'Failed to load invoiceable orders',
      { cause },
    )
  }
}

/**
 * Loads the invoice ledger rows for the right-panel list. v3: no status,
 * no per-customer filtering — flat chronological list, newest billing
 * month first.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getInvoices(): Promise<InvoiceLedgerRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        i.id,
        i.invoice_number,
        i.billing_month,
        i.total_amount::text AS total_amount
      FROM invoices i
      ORDER BY i.billing_month DESC, i.invoice_number DESC
    `)
    return result as unknown as InvoiceLedgerRow[]
  } catch (cause) {
    console.error('getInvoices: query failed', { operation: 'getInvoices', cause })
    throw new DatabaseError('getInvoices', 'Failed to load invoices', { cause })
  }
}

interface InvoiceDetailRow {
  id: string
  invoice_number: string
  billing_month: string
  total_amount: string
  created_at: string
}

function buildInvoicePoRowsQuery(invoiceId: string): SQL {
  return sql`
    SELECT
      o.id,
      o.po_number,
      o.qty_275_recon,
      o.qty_275_rebot,
      o.qty_275_new,
      o.qty_330_recon,
      o.qty_330_rebot,
      o.qty_330_new,
      o.price::text AS price,
      o.backhaul,
      c.company_name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.invoice_id = ${invoiceId}
    ORDER BY o.po_number ASC
  `
}

/**
 * Loads a single invoice plus every PO row attached to it (via
 * `orders.invoice_id`). v3 invoices have no per-invoice customer
 * association, so the customer column is pulled from each PO's order
 * (since the PO retains its `customer_id`). PO rows are sorted by
 * `po_number ASC` for a predictable detail-panel render.
 *
 * @throws {InvoiceNotFoundError} when no row matches `invoiceId`.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail> {
  try {
    const [detailResult, poRowsResult] = await Promise.all([
      db.execute(sql`
        SELECT id, invoice_number, billing_month, total_amount::text AS total_amount, created_at
        FROM invoices WHERE id = ${invoiceId} LIMIT 1
      `),
      db.execute(buildInvoicePoRowsQuery(invoiceId)),
    ])
    const row = (detailResult as unknown as InvoiceDetailRow[])[0]
    if (!row) throw new InvoiceNotFoundError(invoiceId)
    return { ...row, po_rows: poRowsResult as unknown as InvoicePoRow[] }
  } catch (cause) {
    if (cause instanceof InvoiceNotFoundError) throw cause
    console.error('getInvoiceDetail: query failed', {
      operation: 'getInvoiceDetail',
      invoiceId,
      cause,
    })
    throw new DatabaseError('getInvoiceDetail', 'Failed to load invoice detail', { cause })
  }
}
