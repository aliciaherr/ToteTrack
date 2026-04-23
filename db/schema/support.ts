import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core'
import { supportCategoryEnum, supportPriorityEnum, ticketStatusEnum } from './enums'

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  category: supportCategoryEnum('category').notNull(),
  priority: supportPriorityEnum('priority').notNull(),
  description: text('description').notNull(),
  status: ticketStatusEnum('status').notNull().default('open'),
  developer_notes: text('developer_notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportAttachments = pgTable('support_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticket_id: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  file_url: text('file_url').notNull(),
  file_name: text('file_name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('support_attachments_ticket_id_idx').on(t.ticket_id),
])
