import { pgEnum } from 'drizzle-orm/pg-core'

export const poStatusEnum = pgEnum('po_status', [
  'scheduled',
  'completed',
  'cancelled',
  'invoiced',
])

// Feature 15 (migration 0015). Deliberately NOT `po_status`: a pickup is never
// invoiced, so it has no `invoiced` state to model.
export const pickupStatusEnum = pgEnum('pickup_status', [
  'scheduled',
  'completed',
  'cancelled',
])

export const containerSizeEnum = pgEnum('container_size', ['275', '330'])

export const containerTypeEnum = pgEnum('container_type', [
  'rebottled',
  'reconditioned',
  'brand_new',
])

export const customerStatusEnum = pgEnum('customer_status', ['active', 'inactive'])

export const leadStatusEnum = pgEnum('lead_status', [
  'hot',
  'warm',
  'cold',
  'converted',
])

export const supportCategoryEnum = pgEnum('support_category', [
  'bug',
  'feature_request',
  'question',
  'other',
])

export const supportPriorityEnum = pgEnum('support_priority', [
  'low',
  'standard',
  'high',
  'critical',
])

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'closed',
])

// Feature 16 (migration 0016). Classification of a single inbound email after
// the ingest pass has looked at it. `failed` is the loud-failure state — an
// email whose parse or staging threw, kept as a row rather than dropped, so
// nothing is silently discarded.
export const inboundEmailClassificationEnum = pgEnum('inbound_email_classification', [
  'po_found',
  'no_po_found',
  'failed',
])

// Where a staged PO candidate came from inside its email. `email_body` is the
// no-attachment case: the PO is the message text itself, which is why
// `inbound_pos.document_path` is nullable.
export const inboundPoSourceKindEnum = pgEnum('inbound_po_source_kind', [
  'image',
  'pdf',
  'email_body',
])

// Lifecycle of one staged PO candidate. Deliberately NOT `po_status`: these
// are pre-approval states of a document in the review queue, not states of a
// real order. A row reaches `approved` only when a human accepts it, at which
// point `inbound_pos.order_id` points at the `orders` row that was created.
export const inboundPoStatusEnum = pgEnum('inbound_po_status', [
  'pending_extraction',
  'extracting',
  'pending_review',
  'approved',
  'discarded',
  'extraction_failed',
])
