// Pure href builders for every "reach this person" control in the app — the
// production-card popup's Contact menu and the customer detail contact card.
// Lives in `lib/` rather than under one feature folder because both callers
// read the same hand-entered, nullable contact columns and must sanitize them
// identically; a second local implementation is how the mailto injection this
// module closes got re-opened once already.
//
// No 'use client': nothing here touches React or the DOM, so it is importable
// from either side of the boundary and testable without a renderer.

/**
 * A trailing extension, plus the whitespace in front of it, plus the character
 * before that — which the replacement puts back via `$1`.
 *
 * Every part of this is load-bearing. The marker must be preceded by a
 * non-letter (or start of string) and *followed* by digits at end of string,
 * because the bare `x` is a legitimate marker in this dataset and `x` also
 * appears mid-word: an unanchored `x.*$` ate the number in `"Text 555-0100"`
 * and `"fax: 555-0100"`, silently emitting `sms:` for a perfectly dialable
 * phone.
 *
 * Rejected `\b` as the left anchor: there is no word boundary between a digit
 * and an `x`, so `"5550100x204"` would keep its extension and dial a number
 * that does not exist — the exact failure `sanitizePhone` exists to prevent.
 * Rejected a `(?<![a-z])` lookbehind, which expresses this directly: Safari
 * only gained lookbehind in 16.4, and an unsupported regex *literal* is a parse
 * error that takes the whole bundle down rather than degrading.
 *
 * `ext` is listed first so the alternation consumes the whole token rather than
 * stopping at the `x` inside it.
 */
const EXTENSION_SUFFIX = /(^|[^a-z])\s*(?:ext\.?|x)[\s.:#-]*\d+\s*$/i

/** Everything that is not a digit. */
const NON_DIGIT = /\D/g

/** The two free-text channels, structurally — see `isReachable`. */
interface ContactChannels {
  email: string | null
  phone: string | null
}

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
  const withoutExtension = phone.replace(EXTENSION_SUFFIX, '$1')
  const isInternational = withoutExtension.trim().startsWith('+')
  const digits = withoutExtension.replace(NON_DIGIT, '')
  return isInternational ? `+${digits}` : digits
}

/**
 * An `sms:` href for a phone number — the Message channel opens a draft text,
 * not a call.
 *
 * Input with no digits in it at all (`'call the yard'`) returns a bare `sms:`,
 * and that **does** reach a rendered `<a>`: callers gate on `isPresent`, which
 * only asks whether the column holds something, not whether that something is a
 * number. That is deliberate and matches `mailtoHref` — the point is to land the
 * operator in the messaging app with a correctable recipient rather than to
 * block on data we cannot validate. Tapping it opens the composer with an empty
 * To field, which the operator fills by hand; refusing to render would leave
 * them with a note they can read and no way to act on it.
 *
 * @param phone The stored phone string, formatting and extension included.
 */
export function smsHref(phone: string): string {
  return `sms:${sanitizePhone(phone)}`
}

/**
 * A `mailto:` href for an email address.
 *
 * Both sides of the `@` are percent-encoded; only the separator itself is left
 * literal, because mail clients split on it. Encoding the domain matters as much
 * as the local part: `?`, `&` and `=` after the address are read by the mail app
 * as *instructions* — `?cc=`, `?subject=`, `?body=` — and the column is a
 * hand-typed free-text field with nothing validating that it holds an address at
 * all. Left raw, a pasted `john@acme.com?cc=someone` would open a draft with a
 * silent CC that looks entirely normal on the way out.
 *
 * Encoded, that same value degrades into one visibly malformed recipient rather
 * than a quietly wrong one. The draft still opens — the point is to land in the
 * mail app, where a bad recipient can be corrected by hand — it just carries no
 * instructions the stored data smuggled in. A well-formed address is unchanged:
 * `encodeURIComponent` leaves letters, digits, dots and hyphens alone.
 *
 * @param email The stored address; surrounding whitespace is trimmed.
 */
export function mailtoHref(email: string): string {
  const trimmed = email.trim()
  const separator = trimmed.lastIndexOf('@')
  if (separator === -1) return `mailto:${encodeURIComponent(trimmed)}`

  const local = trimmed.slice(0, separator)
  const domain = trimmed.slice(separator + 1)
  return `mailto:${encodeURIComponent(local)}@${encodeURIComponent(domain)}`
}

/**
 * True when this one contact can actually be reached on some channel.
 *
 * Typed structurally rather than against `CalendarContact`: this module sits in
 * `lib/` and is shared with the customer detail card, so depending on one
 * feature's DB row type would point the dependency the wrong way. Both
 * `CalendarContact` and `CustomerContactRow` satisfy this shape.
 */
export function isReachable(contact: ContactChannels): boolean {
  return isPresent(contact.email) || isPresent(contact.phone)
}

/**
 * True when at least one contact in a list can be reached. Drives whether the
 * Contact trigger is enabled — see `ContactMenu` for why the test is "usable
 * channel", not "contact exists".
 */
export function hasAnyChannel(contacts: ContactChannels[]): boolean {
  return contacts.some(isReachable)
}
