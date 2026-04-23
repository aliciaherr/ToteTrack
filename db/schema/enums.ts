import { pgEnum } from 'drizzle-orm/pg-core'

export const poStatusEnum = pgEnum('po_status', [
  'scheduled',
  'completed',
  'cancelled',
  'invoiced',
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
