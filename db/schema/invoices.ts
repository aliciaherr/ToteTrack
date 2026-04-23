import { pgTable, text, uuid, numeric, date, timestamp, index } from 'drizzle-orm/pg-core'

// Invoice v3: month-level, no customer association, no status. One invoice
// per (calendar) month covers every completed PO for that month across all
// customers. The orders.invoice_id FK still links each PO to its invoice.
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_number: text('invoice_number').notNull().unique(),
  billing_month: date('billing_month').notNull(),
  total_amount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('invoices_billing_month_idx').on(t.billing_month),
])
