import { pgTable, text, uuid, date, timestamp, index } from 'drizzle-orm/pg-core'
import { leadStatusEnum } from './enums'
import { customers } from './customers'

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  title: text('title'),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),
  status: leadStatusEnum('status').notNull().default('warm'),
  lead_source: text('lead_source'),
  next_follow_up_date: date('next_follow_up_date'),
  next_action_type: text('next_action_type'),
  converted_customer_id: uuid('converted_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('leads_status_idx').on(t.status),
  index('leads_next_follow_up_date_idx').on(t.next_follow_up_date),
])

export const leadNotes = pgTable('lead_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  lead_id: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('lead_notes_lead_id_idx').on(t.lead_id),
])
