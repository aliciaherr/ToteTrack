/**
 * User-facing fallback for any failure that is not a validation, auth, or
 * business-rule rejection — including a server action that rejects in transit
 * before any server code runs (offline, stale action id after a deploy). The
 * detailed cause is logged via `console.error` and never surfaced to the user
 * (SEC-05, EH-04). Lives here rather than in `lib/actions/auth.guard.ts`
 * (which re-exports it) because that module imports the server-only Supabase
 * client and client components cannot reach it.
 */
export const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'

/**
 * Thrown when a database query fails. Wraps the underlying driver error so
 * callers can match `instanceof DatabaseError` without parsing message strings.
 */
export class DatabaseError extends Error {
  readonly operation: string

  constructor(operation: string, message: string, options?: { cause?: unknown }) {
    super(`${operation}: ${message}`, options)
    this.name = 'DatabaseError'
    this.operation = operation
  }
}

/**
 * Thrown when a date helper receives a value it cannot work with — an
 * unparseable `DB_DATE_FORMAT` string, or a Date that violates the helper's
 * precondition (e.g. `businessWeekDays` given a day that is not a Monday).
 * Carries the offending value and the helper that rejected it so the failure
 * names its own cause instead of surfacing as a downstream `Invalid Date`.
 */
export class InvalidDateError extends Error {
  readonly helper: string
  readonly value: string

  constructor(helper: string, value: string, reason: string) {
    super(`${helper}: ${reason} (received: ${value})`)
    this.name = 'InvalidDateError'
    this.helper = helper
    this.value = value
  }
}

/**
 * Thrown when a customer lookup by id returns no row. Distinct from
 * `DatabaseError`: the query succeeded — the customer simply does not exist
 * (stale bookmark, deleted record). Callers can catch this specifically to
 * render an empty state without surfacing a 500.
 */
export class CustomerNotFoundError extends Error {
  readonly customerId: string

  constructor(customerId: string) {
    super(`Customer not found: ${customerId}`)
    this.name = 'CustomerNotFoundError'
    this.customerId = customerId
  }
}

/**
 * Thrown when an order lookup by id returns no row. Same semantics as
 * `CustomerNotFoundError` — the query succeeded but the row does not exist.
 * Callers can catch this specifically to render the detail-panel empty state
 * without surfacing a 500 to the salesperson.
 */
export class OrderNotFoundError extends Error {
  readonly orderId: string

  constructor(orderId: string) {
    super(`Order not found: ${orderId}`)
    this.name = 'OrderNotFoundError'
    this.orderId = orderId
  }
}

/**
 * Thrown when a lead lookup by id returns no row. Same semantics as
 * `OrderNotFoundError` — the query succeeded but the row does not exist.
 */
export class LeadNotFoundError extends Error {
  readonly leadId: string

  constructor(leadId: string) {
    super(`Lead not found: ${leadId}`)
    this.name = 'LeadNotFoundError'
    this.leadId = leadId
  }
}

/**
 * Thrown when an invoice lookup by id returns no row. Same semantics as
 * the other `*NotFoundError` classes — the query succeeded but the row
 * does not exist (stale bookmark, deleted record).
 */
export class InvoiceNotFoundError extends Error {
  readonly invoiceId: string

  constructor(invoiceId: string) {
    super(`Invoice not found: ${invoiceId}`)
    this.name = 'InvoiceNotFoundError'
    this.invoiceId = invoiceId
  }
}

/**
 * Thrown when a support ticket lookup by id returns no row. Same semantics
 * as the other `*NotFoundError` classes — the query succeeded but the row
 * does not exist (stale bookmark, deleted record).
 */
export class TicketNotFoundError extends Error {
  readonly ticketId: string

  constructor(ticketId: string) {
    super(`Ticket not found: ${ticketId}`)
    this.name = 'TicketNotFoundError'
    this.ticketId = ticketId
  }
}

/**
 * Thrown when a support attachment lookup by storage path returns no row.
 * Used by `getSupportAttachmentSignedUrl` to reject arbitrary path access —
 * the request must name a path that is tracked in `support_attachments`,
 * otherwise the signed-URL API is never called.
 */
export class AttachmentNotFoundError extends Error {
  readonly storagePath: string

  constructor(storagePath: string) {
    super(`Attachment not found: ${storagePath}`)
    this.name = 'AttachmentNotFoundError'
    this.storagePath = storagePath
  }
}
