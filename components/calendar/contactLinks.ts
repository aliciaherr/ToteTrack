import type { CalendarContact } from '@/db/queries/calendar'

// Pure href builders for the production-card popup's Contact menu. No 'use
// client': nothing here touches React or the DOM, so it is importable from
// either side of the boundary and testable without a renderer.

/**
 * Everything after an extension marker, plus the whitespace in front of it.
 * `ext`, `ext.` and a bare `x` all appear in this dataset's free-text phone
 * column. `ext` is listed first so the alternation consumes the whole token
 * rather than stopping at the `x` inside it.
 */
const EXTENSION_SUFFIX = /\s*(?:ext\.?|x).*$/i

/** Everything that is not a digit. */
const NON_DIGIT = /\D/g

/**
 * True when a free-text field actually carries a value. The contact columns are
 * nullable *and* hand-entered, so `''` and `'   '` both mean "not on file" and
 * must read the same as `null` everywhere.
 */
export function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Strips a free-text phone down to something a handset can dial: digits, with a
 * single leading `+` preserved for international numbers.
 *
 * The extension is dropped **before** the digits are kept, not after — an
 * extension is dialled by a human after the call connects, so folding its digits
 * into the number produces a number that does not exist.
 */
function sanitizePhone(phone: string): string {
  const withoutExtension = phone.replace(EXTENSION_SUFFIX, '')
  const isInternational = withoutExtension.trim().startsWith('+')
  const digits = withoutExtension.replace(NON_DIGIT, '')
  return isInternational ? `+${digits}` : digits
}

/**
 * An `sms:` href for a phone number — the Message channel opens a draft text,
 * not a call. Returns `sms:` with an empty target for input that sanitizes down
 * to nothing; callers gate on `isPresent` before rendering a link at all, so
 * that case never reaches a rendered `<a>`.
 *
 * @param phone The stored phone string, formatting and extension included.
 */
export function telHref(phone: string): string {
  return `sms:${sanitizePhone(phone)}`
}

/**
 * A `mailto:` href for an email address.
 *
 * Only the local part is percent-encoded: `+`, spaces and quotes are legal there
 * and would otherwise be read as mailto syntax, while the domain is already
 * restricted to characters that need no escaping — and encoding it would break
 * the `@` split that mail clients rely on.
 *
 * @param email The stored address; surrounding whitespace is trimmed.
 */
export function mailtoHref(email: string): string {
  const trimmed = email.trim()
  const separator = trimmed.lastIndexOf('@')
  if (separator === -1) return `mailto:${encodeURIComponent(trimmed)}`

  const local = trimmed.slice(0, separator)
  const domain = trimmed.slice(separator + 1)
  return `mailto:${encodeURIComponent(local)}@${domain}`
}

/**
 * True when at least one contact can actually be reached. Drives whether the
 * Contact trigger is enabled — see `ContactMenu` for why the test is "usable
 * channel", not "contact exists".
 */
export function hasAnyChannel(contacts: CalendarContact[]): boolean {
  return contacts.some((contact) => isPresent(contact.email) || isPresent(contact.phone))
}
