import type { CustomerDetail } from '@/db/queries/customers'
import type { CustomerInput } from '@/lib/actions/customers'

/**
 * Shared Tailwind class string for every text/number/email input across the
 * customer form. Extracted here to keep the scalar-fields and contact-fields
 * sub-components visually identical without copy-pasting the class list.
 */
export const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring'

export interface CustomerContactFormValue {
  id?: string
  name: string
  role: string
  email: string
  phone: string
  is_primary: boolean
}

export interface CustomerFormValues {
  company_name: string
  status: 'active' | 'inactive'
  contact_frequency_days: string
  notes: string
  contacts: CustomerContactFormValue[]
}

export const EMPTY_CONTACT: CustomerContactFormValue = {
  name: '',
  role: '',
  email: '',
  phone: '',
  is_primary: false,
}

export const EMPTY_FORM_VALUES: CustomerFormValues = {
  company_name: '',
  status: 'active',
  contact_frequency_days: '',
  notes: '',
  contacts: [{ ...EMPTY_CONTACT, is_primary: true }],
}

/**
 * Seeds `CustomerFormValues` for the customer form. Returns `EMPTY_FORM_VALUES`
 * (one empty primary contact, active status) when `detail` is null/undefined —
 * the create-mode default. Otherwise maps the customer detail row into the
 * form's string-shaped fields, preserving existing contact ids so an edit can
 * round-trip without losing row identity.
 * @param detail Existing customer detail (edit mode) or `null` / `undefined` for a new customer.
 * @returns Form values ready to pass as `useForm({ defaultValues })`.
 */
export function detailToFormValues(detail: CustomerDetail | null | undefined): CustomerFormValues {
  if (!detail) return EMPTY_FORM_VALUES
  const contacts = detail.contacts.length
    ? detail.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        role: contact.role ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        is_primary: contact.is_primary,
      }))
    : [{ ...EMPTY_CONTACT, is_primary: true }]
  return {
    company_name: detail.company_name,
    status: detail.status,
    contact_frequency_days: detail.contact_frequency_days?.toString() ?? '',
    notes: detail.notes ?? '',
    contacts,
  }
}

function parseFrequency(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function stringOrNull(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Converts form values (all strings for html inputs) into the action's
 * CustomerInput shape. Empty strings for role/email/phone become null so the
 * server Zod schema sees absent values consistently.
 */
export function formValuesToInput(values: CustomerFormValues): CustomerInput {
  return {
    company_name: values.company_name.trim(),
    status: values.status,
    contact_frequency_days: parseFrequency(values.contact_frequency_days),
    notes: stringOrNull(values.notes),
    contacts: values.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name.trim(),
      role: stringOrNull(contact.role),
      email: stringOrNull(contact.email),
      phone: stringOrNull(contact.phone),
      is_primary: contact.is_primary,
    })),
  }
}
