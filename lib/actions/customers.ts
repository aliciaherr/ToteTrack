'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { customers, customerContacts, orders } from '@/db/schema'
import { UUID_RE } from '@/lib/validators/uuid'
import { firstZodMessage, nullIfBlank } from './orders.validation'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'
import { MAX_CONTACTS_PER_CUSTOMER } from './customers.constants'

// Max 10 years — a manual frequency override beyond this is almost certainly
// an entry error.
const MAX_FREQUENCY_DAYS = 10 * 365

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const COMPANY_NAME_MAX = 200
const CONTACT_NAME_MAX = 120
const CONTACT_ROLE_MAX = 120
const CONTACT_EMAIL_MAX = 254
const CONTACT_PHONE_MAX = 40
const NOTES_MAX = 2000

const contactSchema = z
  .object({
    id: z.string().regex(UUID_RE).optional(),
    name: z.string().min(1, 'Contact name is required.').max(CONTACT_NAME_MAX),
    role: z.string().max(CONTACT_ROLE_MAX).nullable().optional(),
    email: z.string().max(CONTACT_EMAIL_MAX).nullable().optional(),
    phone: z.string().max(CONTACT_PHONE_MAX).nullable().optional(),
    is_primary: z.boolean(),
  })
  .superRefine((contact, ctx) => {
    // Email and phone are both optional. A contact may be name-only — the
    // salesperson may track decision-makers even when direct contact info
    // lives elsewhere (phone book, paper, etc.). Validate format only when
    // an email is actually provided.
    const emailTrimmed = (contact.email ?? '').trim()
    if (emailTrimmed && !EMAIL_RE.test(emailTrimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Invalid email format.',
      })
    }
  })

const customerInputSchema = z
  .object({
    company_name: z.string().min(1, 'Company name is required.').max(COMPANY_NAME_MAX),
    status: z.enum(['active', 'inactive']).default('active'),
    contact_frequency_days: z
      .number()
      .int('Contact frequency must be a whole number of days.')
      .positive('Contact frequency must be greater than 0.')
      .max(MAX_FREQUENCY_DAYS)
      .nullable()
      .optional(),
    notes: z.string().max(NOTES_MAX).nullable().optional(),
    contacts: z
      .array(contactSchema)
      .min(1, 'At least one contact is required.')
      .max(MAX_CONTACTS_PER_CUSTOMER, `Up to ${MAX_CONTACTS_PER_CUSTOMER} contacts allowed.`),
  })
  .superRefine((data, ctx) => {
    const primaries = data.contacts.filter((c) => c.is_primary).length
    if (primaries !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contacts'],
        message: 'Exactly one contact must be marked as primary.',
      })
    }
  })

export type CustomerInput = z.input<typeof customerInputSchema>
type ValidatedCustomer = z.output<typeof customerInputSchema>
type ValidatedContact = ValidatedCustomer['contacts'][number]

function normalizeContact(contact: ValidatedContact) {
  return {
    name: contact.name.trim(),
    role: nullIfBlank(contact.role),
    email: nullIfBlank(contact.email),
    phone: nullIfBlank(contact.phone),
    is_primary: contact.is_primary,
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertCustomerRecord(tx: Tx, data: ValidatedCustomer): Promise<{ id: string }> {
  const [row] = await tx
    .insert(customers)
    .values({
      company_name: data.company_name.trim(),
      status: data.status,
      contact_frequency_days: data.contact_frequency_days ?? null,
      notes: nullIfBlank(data.notes),
    })
    .returning({ id: customers.id })
  return row
}

async function insertContacts(
  tx: Tx,
  customerId: string,
  contacts: ValidatedContact[],
): Promise<void> {
  await tx.insert(customerContacts).values(
    contacts.map((contact) => ({
      customer_id: customerId,
      ...normalizeContact(contact),
    })),
  )
}

/**
 * Creates a customer and its initial contacts atomically. Runs in a single
 * DB transaction — if contact insertion fails, the customer row is rolled back.
 * Returns the new customer id on success, or a user-facing error message.
 * @param input Customer data plus 1–5 contacts.
 */
export async function createCustomer(
  input: CustomerInput,
): Promise<{ id: string } | { error: string }> {
  // Captured before the transaction so the failure log can identify which
  // customer the write was for (EH-02). Undefined until validation passes.
  let companyName: string | undefined
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const parsed = customerInputSchema.safeParse(input)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }
    companyName = parsed.data.company_name

    const result = await db.transaction(async (tx) => {
      const customer = await insertCustomerRecord(tx, parsed.data)
      await insertContacts(tx, customer.id, parsed.data.contacts)
      return customer
    })
    revalidatePath('/customers')
    return { id: result.id }
  } catch (cause) {
    console.error('createCustomer: transaction failed', { companyName, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Updates a customer and replaces its contact list atomically. The incoming
 * `contacts` array is authoritative — any contacts removed from it are
 * deleted. Runs in a single DB transaction.
 * @param id UUID of the customer to update.
 * @param input New customer data plus the full replacement contact list.
 */
export async function updateCustomer(
  id: string,
  input: CustomerInput,
): Promise<{ success: true } | { error: string }> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    if (!UUID_RE.test(id)) return { error: 'Invalid customer id.' }

    const parsed = customerInputSchema.safeParse(input)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }

    await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({
          company_name: parsed.data.company_name.trim(),
          status: parsed.data.status,
          contact_frequency_days: parsed.data.contact_frequency_days ?? null,
          notes: nullIfBlank(parsed.data.notes),
          updated_at: new Date(),
        })
        .where(eq(customers.id, id))
      await tx.delete(customerContacts).where(eq(customerContacts.customer_id, id))
      await insertContacts(tx, id, parsed.data.contacts)
    })
    revalidatePath('/customers')
    return { success: true }
  } catch (cause) {
    console.error('updateCustomer: transaction failed', { customerId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Hard-deletes a customer. Rejects if the customer has any orders — order
 * history must not be orphaned. To remove a customer with history, set status
 * to `inactive` via the customer form. See CONSTRAINT-13.
 * @param id UUID of the customer to delete.
 */
export async function deleteCustomer(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    if (!UUID_RE.test(id)) return { error: 'Invalid customer id.' }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.customer_id, id))

    if (count > 0) {
      return {
        error:
          'Cannot delete a customer with order history. Set them to Inactive instead.',
      }
    }

    await db.delete(customers).where(eq(customers.id, id))
    revalidatePath('/customers')
    return { success: true }
  } catch (cause) {
    console.error('deleteCustomer: query failed', { customerId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
