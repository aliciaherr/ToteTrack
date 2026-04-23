'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { leads, leadNotes } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/validators/uuid'
import {
  loadLeadForConversion,
  findDuplicateCustomer,
  runConversionTransaction,
} from './leads.convert'
import { NOTE_CONTENT_MAX } from './leads.constants'

const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const NAME_MAX = 200
const COMPANY_MAX = 200
const TITLE_MAX = 200
const EMAIL_MAX = 254
const PHONE_MAX = 40
const LEAD_SOURCE_MAX = 200
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.'
}

async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { error: 'You are not signed in.' }
  return null
}

const addLeadNoteSchema = z.object({
  // .trim() runs before .min(1) so whitespace-only strings are caught correctly.
  content: z.string().trim().min(1, 'Note cannot be empty.').max(NOTE_CONTENT_MAX),
})

/**
 * Appends a note to the lead's note log. Also touches `leads.updated_at`
 * so the "Last Contact" date in the detail panel stays current.
 */
export async function addLeadNote(
  leadId: string,
  content: string,
): Promise<{ id: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError
  if (!UUID_RE.test(leadId)) return { error: 'Invalid lead id.' }

  const parsed = addLeadNoteSchema.safeParse({ content })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const [row] = await db
      .insert(leadNotes)
      .values({ lead_id: leadId, content: parsed.data.content })
      .returning({ id: leadNotes.id })
    await db.update(leads).set({ updated_at: new Date() }).where(eq(leads.id, leadId))
    revalidatePath('/leads')
    return { id: row.id }
  } catch (cause) {
    console.error('addLeadNote: insert failed', { leadId, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

const setNextActionSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, 'Invalid date format.'),
  // `time` is collected for UX but is not persisted — the schema has no time column.
  time: z.string().regex(TIME_RE, 'Invalid time format.'),
  actionType: z
    .string()
    .refine((v) => ['call', 'email', 'visit', 'other'].includes(v), {
      message: 'Invalid action type.',
    }),
})

export type NextActionInput = z.input<typeof setNextActionSchema>

/**
 * Saves the next action date and type for a lead. The `time` field is
 * validated but not stored — the `next_follow_up_date` column is a date,
 * not a timestamp.
 */
export async function setNextAction(
  leadId: string,
  data: NextActionInput,
): Promise<{ success: true } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError
  if (!UUID_RE.test(leadId)) return { error: 'Invalid lead id.' }

  const parsed = setNextActionSchema.safeParse(data)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    await db
      .update(leads)
      .set({
        next_follow_up_date: parsed.data.date,
        next_action_type: parsed.data.actionType,
        updated_at: new Date(),
      })
      .where(eq(leads.id, leadId))
    revalidatePath('/leads')
    return { success: true }
  } catch (cause) {
    console.error('setNextAction: update failed', { leadId, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

// ─── Lead CRUD ────────────────────────────────────────────────────────────────

const leadInputSchema = z
  .object({
    name: z.string().min(1, 'Name is required.').max(NAME_MAX),
    company: z.string().max(COMPANY_MAX).nullable().optional(),
    title: z.string().max(TITLE_MAX).nullable().optional(),
    email: z.string().max(EMAIL_MAX).nullable().optional(),
    phone: z.string().max(PHONE_MAX).nullable().optional(),
    status: z.enum(['hot', 'warm', 'cold']).default('warm'),
    lead_source: z.string().max(LEAD_SOURCE_MAX).nullable().optional(),
    next_follow_up_date: z.string().regex(ISO_DATE_RE).nullable().optional(),
    next_action_type: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Email and phone are both optional. Format-check email only when one is
    // actually provided.
    const email = (data.email ?? '').trim()
    if (email && !EMAIL_RE.test(email)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Invalid email format.' })
    }
  })

export type LeadInput = z.input<typeof leadInputSchema>

function nullIfBlank(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Creates a new lead record. Requires name and at least one contact method
 * (email or phone). Server-side Zod validates all inputs before the insert.
 */
export async function createLead(
  input: LeadInput,
): Promise<{ id: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  const parsed = leadInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const [row] = await db
      .insert(leads)
      .values({
        name: parsed.data.name.trim(),
        company: nullIfBlank(parsed.data.company),
        title: nullIfBlank(parsed.data.title),
        email: nullIfBlank(parsed.data.email),
        phone: nullIfBlank(parsed.data.phone),
        status: parsed.data.status,
        lead_source: nullIfBlank(parsed.data.lead_source),
        next_follow_up_date: parsed.data.next_follow_up_date ?? null,
        next_action_type: parsed.data.next_action_type ?? null,
      })
      .returning({ id: leads.id })
    revalidatePath('/leads')
    return { id: row.id }
  } catch (cause) {
    console.error('createLead: insert failed', { cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Updates an existing lead record. Status can be changed via this action
 * (hot/warm/cold). 'converted' is set exclusively by convertLeadToCustomer.
 */
export async function updateLead(
  id: string,
  input: LeadInput,
): Promise<{ success: true } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(id)) return { error: 'Invalid lead id.' }

  const parsed = leadInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    await db
      .update(leads)
      .set({
        name: parsed.data.name.trim(),
        company: nullIfBlank(parsed.data.company),
        title: nullIfBlank(parsed.data.title),
        email: nullIfBlank(parsed.data.email),
        phone: nullIfBlank(parsed.data.phone),
        status: parsed.data.status,
        lead_source: nullIfBlank(parsed.data.lead_source),
        next_follow_up_date: parsed.data.next_follow_up_date ?? null,
        next_action_type: parsed.data.next_action_type ?? null,
        updated_at: new Date(),
      })
      .where(eq(leads.id, id))
    revalidatePath('/leads')
    return { success: true }
  } catch (cause) {
    console.error('updateLead: update failed', { leadId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Atomically converts a lead to a customer. Creates a customer record + a
 * primary contact from the lead's fields, then sets lead status to 'converted'.
 *
 * If the lead's company name matches an existing customer (case-insensitive)
 * and `force` is false, returns `{ warning }` instead of proceeding — the
 * caller shows the warning and can re-call with force=true to bypass.
 *
 * The DB transaction guarantees atomicity: if the customer insert fails, the
 * lead's status remains unchanged.
 */
export async function convertLeadToCustomer(
  leadId: string,
  force = false,
): Promise<{ customerId: string } | { warning: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(leadId)) return { error: 'Invalid lead id.' }

  try {
    const lead = await loadLeadForConversion(leadId)
    if (!lead) return { error: 'Lead not found.' }
    if (lead.status === 'converted') return { error: 'This lead has already been converted.' }

    if (!force && lead.company) {
      const duplicate = await findDuplicateCustomer(lead.company)
      if (duplicate) {
        return { warning: `A customer named "${duplicate.company_name}" already exists. Convert anyway?` }
      }
    }

    const result = await db.transaction((tx) => runConversionTransaction(tx, leadId, lead))
    revalidatePath('/customers')
    revalidatePath('/leads')
    return result
  } catch (cause) {
    console.error('convertLeadToCustomer: operation failed', { leadId, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
