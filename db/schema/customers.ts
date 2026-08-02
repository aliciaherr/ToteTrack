import { pgTable, text, uuid, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { customerStatusEnum } from './enums'

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_name: text('company_name').notNull(),
  status: customerStatusEnum('status').notNull().default('active'),
  contact_frequency_days: integer('contact_frequency_days'),
  // DEPRECATED (Feature 14 / CONSTRAINT-21) — retained in DB, never read/written by app code; drop deferred.
  default_delivery_address: text('default_delivery_address'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const customerContacts = pgTable('customer_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  customer_id: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email'),
  phone: text('phone'),
  is_primary: boolean('is_primary').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('customer_contacts_customer_id_idx').on(t.customer_id),
])

export const customerAddresses = pgTable('customer_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  customer_id: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('customer_addresses_customer_id_idx').on(t.customer_id),
  // Mirrors migration 0013 (audit L-03): dedupe is DB-enforced, and the
  // upsert in addCustomerAddress / recordDeliveryAddressUsage targets it.
  uniqueIndex('customer_addresses_customer_id_address_uq').on(t.customer_id, t.address),
])
