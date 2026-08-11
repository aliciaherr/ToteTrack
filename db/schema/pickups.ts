import { pgTable, text, uuid, integer, date, timestamp, index } from 'drizzle-orm/pg-core'
import { pickupStatusEnum } from './enums'
import { customers } from './customers'

/**
 * Collections of empty totes from a customer (Feature 15, migration 0015).
 *
 * A separate entity from `orders`, not a flag on one: a pickup has no price,
 * no PO number, no document and no invoice link, and appears on no revenue or
 * dashboard surface.
 *
 * `pickup_date` **is** the calendar placement (NULL = unscheduled), unlike an
 * order where the delivery promise and the build day are two columns.
 * `sort_index` is the hand-placed position inside a day column, NULL until
 * someone drags the card — mirroring `orders.production_sort_index`.
 *
 * `address` is a text snapshot, never an FK into `customer_addresses`
 * (CONSTRAINT-21). The FK to `customers` is `restrict`, matching orders:
 * pickup history is never orphaned by a customer delete (CONSTRAINT-13).
 */
export const pickups = pgTable('pickups', {
  id: uuid('id').primaryKey().defaultRandom(),
  customer_id: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: pickupStatusEnum('status').notNull().default('scheduled'),
  qty_275: integer('qty_275').notNull().default(0),
  qty_330: integer('qty_330').notNull().default(0),
  pickup_date: date('pickup_date'),
  sort_index: integer('sort_index'),
  address: text('address'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pickups_customer_id_idx').on(t.customer_id),
  index('pickups_status_idx').on(t.status),
  index('pickups_pickup_date_idx').on(t.pickup_date),
])
