import { pgTable, text, uuid, integer, boolean, numeric, date, timestamp, index } from 'drizzle-orm/pg-core'
import { poStatusEnum, containerSizeEnum, containerTypeEnum } from './enums'
import { customers } from './customers'
import { invoices } from './invoices'

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  po_number: text('po_number').notNull().unique(),
  customer_id: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: poStatusEnum('status').notNull().default('scheduled'),
  container_size: containerSizeEnum('container_size').notNull(),
  container_type: containerTypeEnum('container_type').notNull(),
  quantity: integer('quantity').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  pickup_only: boolean('pickup_only').notNull().default(false),
  delivery_address: text('delivery_address'),
  requested_delivery_date: date('requested_delivery_date'),
  backhaul: boolean('backhaul').notNull().default(false),
  document_url: text('document_url'),
  notes: text('notes'),
  invoice_id: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('orders_customer_id_idx').on(t.customer_id),
  index('orders_status_idx').on(t.status),
  index('orders_invoice_id_idx').on(t.invoice_id),
  index('orders_requested_delivery_date_idx').on(t.requested_delivery_date),
])
