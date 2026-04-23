import type { LeadDetail } from '@/db/queries/leads'
import type { LeadInput } from '@/lib/actions/leads'

export interface LeadFormValues {
  name: string
  company: string
  title: string
  email: string
  phone: string
  status: 'hot' | 'warm' | 'cold'
  lead_source: string
  next_follow_up_date: string
  next_action_type: string
}

/** Shared Tailwind class for all form text inputs in LeadForm. */
export const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'

export const EMPTY_FORM_VALUES: LeadFormValues = {
  name: '',
  company: '',
  title: '',
  email: '',
  phone: '',
  status: 'warm',
  lead_source: '',
  next_follow_up_date: '',
  next_action_type: '',
}

/**
 * Converts a LeadDetail (server-side shape) into form values for pre-filling
 * an edit form. Null fields become empty strings to match controlled inputs.
 */
export function detailToFormValues(detail: LeadDetail): LeadFormValues {
  return {
    name: detail.name,
    company: detail.company ?? '',
    title: detail.title ?? '',
    email: detail.email ?? '',
    phone: detail.phone ?? '',
    status: (detail.status as 'hot' | 'warm' | 'cold') ?? 'warm',
    lead_source: detail.lead_source ?? '',
    next_follow_up_date: detail.next_follow_up_date ?? '',
    next_action_type: detail.next_action_type ?? '',
  }
}

/**
 * Normalises form values into the LeadInput shape expected by the server
 * actions. Empty strings become null for nullable DB columns.
 */
export function formValuesToLeadInput(values: LeadFormValues): LeadInput {
  function nullIfEmpty(v: string): string | null {
    const t = v.trim()
    return t === '' ? null : t
  }
  return {
    name: values.name.trim(),
    company: nullIfEmpty(values.company),
    title: nullIfEmpty(values.title),
    email: nullIfEmpty(values.email),
    phone: nullIfEmpty(values.phone),
    status: values.status,
    lead_source: nullIfEmpty(values.lead_source),
    next_follow_up_date: nullIfEmpty(values.next_follow_up_date),
    next_action_type: nullIfEmpty(values.next_action_type),
  }
}
