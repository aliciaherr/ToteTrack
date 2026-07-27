import { pgTable, text, uuid, integer, boolean, numeric, date, timestamp, index } from 'drizzle-orm/pg-core'
import { poStatusEnum } from './enums'
import { customers } from './customers'
import { invoices } from './invoices'

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  po_number: text('po_number').notNull().unique(),
  customer_id: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: poStatusEnum('status').notNull().default('scheduled'),
  qty_275_recon: integer('qty_275_recon').notNull().default(0),
  qty_275_rebot: integer('qty_275_rebot').notNull().default(0),
  qty_275_new: integer('qty_275_new').notNull().default(0),
  qty_330_recon: integer('qty_330_recon').notNull().default(0),
  qty_330_rebot: integer('qty_330_rebot').notNull().default(0),
  qty_330_new: integer('qty_330_new').notNull().default(0),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  unit_price_275_recon: numeric('unit_price_275_recon', { precision: 10, scale: 2 }),
  unit_price_275_rebot: numeric('unit_price_275_rebot', { precision: 10, scale: 2 }),
  unit_price_275_new: numeric('unit_price_275_new', { precision: 10, scale: 2 }),
  unit_price_330_recon: numeric('unit_price_330_recon', { precision: 10, scale: 2 }),
  unit_price_330_rebot: numeric('unit_price_330_rebot', { precision: 10, scale: 2 }),
  unit_price_330_new: numeric('unit_price_330_new', { precision: 10, scale: 2 }),
  pickup_only: boolean('pickup_only').notNull().default(false),
  delivery_address: text('delivery_address'),
  requested_delivery_date: date('requested_delivery_date'),
  production_date: date('production_date'),
  same_day_delivery: boolean('same_day_delivery').notNull().default(false),
  production_sort_index: integer('production_sort_index'),
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
  index('orders_production_date_idx').on(t.production_date),
])
