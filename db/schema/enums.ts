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
