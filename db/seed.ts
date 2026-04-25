/**
 * ToteTrack dev/testing seed script.
 *
 * Usage:
 *   npm run db:seed               — wipe everything, then insert dummy data
 *   npm run db:wipe               — wipe everything only (no insert)
 *
 * Generates ~28 months of realistic-looking data (January 2024 → current
 * month) exercising every dashboard widget and filter. Safe to run any
 * number of times — each run TRUNCATE CASCADEs all eight tables first.
 *
 * Connects via DATABASE_URL directly (bypasses RLS — scripts run as the
 * DB owner). Run in dev only; never run against production.
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { addDays, format, startOfMonth, subDays } from 'date-fns'
import {
  customers,
  customerContacts,
  orders,
  leads,
  leadNotes,
  invoices,
  supportTickets,
} from './schema'

if (!process.env.DATABASE_URL) {
  console.error('[seed] DATABASE_URL is not set. Run via `npm run db:seed` (which uses --env-file=.env.local).')
  process.exit(1)
}

const WIPE_ONLY = process.argv.includes('--wipe-only')
const TODAY = new Date()
const CURRENT_MONTH_START = startOfMonth(TODAY)

// ===== Helpers =====

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[rand(0, arr.length - 1)]!
}

function maybe(probability: number): boolean {
  return Math.random() < probability
}

function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function money(n: number): string {
  return n.toFixed(2)
}

function emailFromCompany(personName: string, companyName: string): string {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const user = personName.toLowerCase().replace(/\s+/g, '.')
  return `${user}@${slug}.example`
}

// ===== Data pools =====

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul'] as const
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Davis', 'Wilson', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson'] as const
const ROLES = ['Operations Manager', 'Procurement Lead', 'Logistics Coordinator', 'Owner', 'General Manager', 'Plant Manager', 'Purchasing Agent'] as const
const ADDRESSES = [
  '1234 Industrial Blvd, Houston, TX 77001',
  '789 Commerce Pkwy, Atlanta, GA 30301',
  '456 Harbor Rd, Long Beach, CA 90802',
  '2500 Warehouse Ln, Chicago, IL 60607',
  '910 Riverside Ave, St. Louis, MO 63101',
  '15 Dockside Way, Newark, NJ 07102',
  '3421 Freight Terminal Dr, Memphis, TN 38101',
  '67 Port Authority Rd, Savannah, GA 31401',
] as const
const LEAD_SOURCES = ['Trade show', 'Referral', 'Cold call', 'Website form', 'LinkedIn', 'Industry publication'] as const
const LEAD_NOTE_SAMPLES = [
  "Had a good call. They're evaluating 2 other vendors.",
  'Budget approved. Looking at Q2 start date.',
  'Sent quote for 330 gal rebottled totes. Awaiting response.',
  'Conference call scheduled for next Tuesday.',
  'Checking in — they went quiet after the last quote.',
  'They need volume pricing. Follow up with updated sheet.',
  'Referral came from an existing customer. Warm lead.',
] as const
const ORDER_NOTES = [
  'Customer confirmed delivery window.',
  'Gate code 1234 for warehouse entry.',
  'Call ahead 30 minutes before arrival.',
  'Driver must wear high-vis vest at this site.',
] as const
const TICKET_TITLES = [
  { title: "Order status doesn't update after marking complete", category: 'bug', priority: 'high' },
  { title: 'Feature request: bulk import customers from CSV', category: 'feature_request', priority: 'low' },
  { title: 'Cannot save note with special characters', category: 'bug', priority: 'standard' },
  { title: 'Invoice PDF export for customers', category: 'feature_request', priority: 'standard' },
  { title: "Dashboard chart doesn't load on Safari", category: 'bug', priority: 'critical' },
  { title: 'Add SMS reminder for follow-ups', category: 'feature_request', priority: 'low' },
] as const

const LEAD_STATUSES = ['hot', 'warm', 'cold'] as const
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

type SeedSize = '275' | '330'
type SeedType = 'rebottled' | 'reconditioned' | 'brand_new'

// All 6 (size × type) cells of the wide-row PO schema (CONSTRAINT-18).
const QTY_CELLS: ReadonlyArray<{ size: SeedSize; type: SeedType; col: 'qty_275_recon' | 'qty_275_rebot' | 'qty_275_new' | 'qty_330_recon' | 'qty_330_rebot' | 'qty_330_new' }> = [
  { size: '275', type: 'reconditioned', col: 'qty_275_recon' },
  { size: '275', type: 'rebottled', col: 'qty_275_rebot' },
  { size: '275', type: 'brand_new', col: 'qty_275_new' },
  { size: '330', type: 'reconditioned', col: 'qty_330_recon' },
  { size: '330', type: 'rebottled', col: 'qty_330_rebot' },
  { size: '330', type: 'brand_new', col: 'qty_330_new' },
]

// Unit-price bands per (size, type) — rough but realistic.
function unitPriceFor(size: SeedSize, type: SeedType): number {
  if (size === '275') {
    if (type === 'brand_new') return rand(80, 110)
    if (type === 'reconditioned') return rand(55, 75)
    return rand(40, 55)
  }
  if (type === 'brand_new') return rand(110, 150)
  if (type === 'reconditioned') return rand(70, 95)
  return rand(50, 70)
}

interface PoQtyShape {
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
}

const ZERO_PO_QTY: PoQtyShape = {
  qty_275_recon: 0,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
}

/**
 * Build a (qty, price) pair for one PO. ~85% of POs use a single (size×type)
 * combo; ~15% mix two combos to exercise the new wide-row schema. Total
 * price is the sum across each non-zero cell, computed via the same
 * per-unit price bands that the single-combo seed used.
 */
function buildPoQtyAndPrice(): { qty: PoQtyShape; price: number } {
  const cellCount = maybe(0.15) ? 2 : 1
  const pool = [...QTY_CELLS]
  const qty: PoQtyShape = { ...ZERO_PO_QTY }
  let total = 0
  for (let i = 0; i < cellCount; i++) {
    const idx = rand(0, pool.length - 1)
    const cell = pool.splice(idx, 1)[0]!
    const cellQty = rand(5, 30)
    qty[cell.col] = cellQty
    total += cellQty * unitPriceFor(cell.size, cell.type)
  }
  return { qty, price: total }
}

// ===== Customer archetypes =====
// Each entry defines one customer's history shape: active/inactive,
// manual frequency override, first-order age, average order cadence,
// and whether they stopped ordering recently (makes them overdue).

interface CustomerArchetype {
  name: string
  active: boolean
  manualFreqDays: number | null
  firstOrderDaysAgo: number
  cadenceDays: number
  stoppedOrderingDaysAgo: number | null
  hasManyContacts: boolean
}

const CUSTOMER_ARCHETYPES: CustomerArchetype[] = [
  { name: 'Acme Industrial Solutions', active: true, manualFreqDays: 30, firstOrderDaysAgo: 800, cadenceDays: 28, stoppedOrderingDaysAgo: null, hasManyContacts: true },
  { name: 'Beta Logistics Group', active: true, manualFreqDays: null, firstOrderDaysAgo: 650, cadenceDays: 45, stoppedOrderingDaysAgo: null, hasManyContacts: false },
  { name: 'Gamma Chemical Co', active: true, manualFreqDays: null, firstOrderDaysAgo: 500, cadenceDays: 60, stoppedOrderingDaysAgo: null, hasManyContacts: true },
  { name: 'Delta Shipping Ltd', active: true, manualFreqDays: 90, firstOrderDaysAgo: 730, cadenceDays: 88, stoppedOrderingDaysAgo: 120, hasManyContacts: false },
  { name: 'Epsilon Manufacturing', active: true, manualFreqDays: null, firstOrderDaysAgo: 400, cadenceDays: 30, stoppedOrderingDaysAgo: 50, hasManyContacts: false },
  { name: 'Foxtrot Services', active: true, manualFreqDays: null, firstOrderDaysAgo: 300, cadenceDays: 75, stoppedOrderingDaysAgo: null, hasManyContacts: false },
  { name: 'Grayson Metals', active: true, manualFreqDays: 21, firstOrderDaysAgo: 600, cadenceDays: 22, stoppedOrderingDaysAgo: null, hasManyContacts: true },
  { name: 'Halcyon Distribution', active: true, manualFreqDays: null, firstOrderDaysAgo: 700, cadenceDays: 90, stoppedOrderingDaysAgo: 150, hasManyContacts: false },
  { name: 'Ionic Transport', active: false, manualFreqDays: null, firstOrderDaysAgo: 800, cadenceDays: 120, stoppedOrderingDaysAgo: 200, hasManyContacts: false },
  { name: 'Juniper Container Co', active: false, manualFreqDays: 60, firstOrderDaysAgo: 850, cadenceDays: 60, stoppedOrderingDaysAgo: 300, hasManyContacts: true },
]

// ===== Database connection =====

const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
const db = drizzle(client)

// ===== Wipe =====

async function wipe() {
  await client.unsafe(`
    TRUNCATE TABLE
      customer_contacts,
      customers,
      orders,
      leads,
      lead_notes,
      invoices,
      support_tickets,
      support_attachments
    CASCADE
  `)
  console.log('  Wiped 8 tables via TRUNCATE CASCADE.')
}

// ===== Seed: customers =====

interface SeededCustomer extends CustomerArchetype {
  id: string
}

async function seedCustomers(): Promise<SeededCustomer[]> {
  const out: SeededCustomer[] = []
  for (const arch of CUSTOMER_ARCHETYPES) {
    const [row] = await db.insert(customers).values({
      company_name: arch.name,
      status: arch.active ? 'active' : 'inactive',
      contact_frequency_days: arch.manualFreqDays,
      notes: maybe(0.3) ? 'Prefers deliveries before noon.' : null,
    }).returning({ id: customers.id })

    const customerId = row!.id
    const contactCount = arch.hasManyContacts ? rand(2, 3) : 1
    for (let i = 0; i < contactCount; i++) {
      const personName = `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`
      await db.insert(customerContacts).values({
        customer_id: customerId,
        name: personName,
        role: pickRandom(ROLES),
        email: maybe(0.85) ? emailFromCompany(personName, arch.name) : null,
        phone: maybe(0.7) ? `555-${rand(100, 999)}-${rand(1000, 9999)}` : null,
        is_primary: i === 0,
      })
    }
    out.push({ ...arch, id: customerId })
  }
  console.log(`  Seeded ${out.length} customers with contacts.`)
  return out
}

// ===== Seed: orders =====

interface SeededOrder {
  id: string
  customer_id: string
  status: 'scheduled' | 'completed' | 'cancelled'
  deliveryDate: Date
  price: number
}

function statusForAge(daysAgo: number): SeededOrder['status'] {
  if (daysAgo < 14) return 'scheduled'
  if (daysAgo < 30) {
    const r = Math.random()
    if (r < 0.85) return 'completed'
    return 'cancelled'
  }
  return maybe(0.92) ? 'completed' : 'cancelled'
}

async function seedOrders(customerSeeds: SeededCustomer[]): Promise<SeededOrder[]> {
  const all: SeededOrder[] = []
  let poCounter = 1

  for (const c of customerSeeds) {
    const endDaysAgo = c.stoppedOrderingDaysAgo ?? -14 // -14 = allow some future-dated (scheduled) orders
    let offset = c.firstOrderDaysAgo
    while (offset > endDaysAgo) {
      const deliveryDate = addDays(subDays(TODAY, offset), rand(-5, 5))
      const daysAgo = Math.floor((TODAY.getTime() - deliveryDate.getTime()) / (24 * 3600 * 1000))
      const status = statusForAge(daysAgo)
      const { qty, price } = buildPoQtyAndPrice()
      const pickupOnly = maybe(0.15)

      const [row] = await db.insert(orders).values({
        po_number: `PO-${String(poCounter).padStart(4, '0')}`,
        customer_id: c.id,
        status,
        ...qty,
        price: money(price),
        pickup_only: pickupOnly,
        delivery_address: pickupOnly ? null : pickRandom(ADDRESSES),
        requested_delivery_date: isoDate(deliveryDate),
        backhaul: maybe(0.12),
        notes: maybe(0.25) ? pickRandom(ORDER_NOTES) : null,
      }).returning({ id: orders.id })

      poCounter++
      all.push({ id: row!.id, customer_id: c.id, status, deliveryDate, price })
      offset -= Math.round(c.cadenceDays + rand(-5, 5))
    }
  }
  console.log(`  Seeded ${all.length} orders.`)
  return all
}

// ===== Seed: invoices =====

async function seedInvoices(orderSeeds: SeededOrder[]): Promise<void> {
  // v3: one invoice per (yyyy-MM) covering every customer's completed
  // past-month POs. Group by month only — customer_id no longer lives on
  // the invoice row.
  const groups = new Map<string, SeededOrder[]>()
  for (const o of orderSeeds) {
    if (o.status !== 'completed') continue
    if (o.deliveryDate >= CURRENT_MONTH_START) continue
    const key = format(o.deliveryDate, 'yyyy-MM')
    const arr = groups.get(key) ?? []
    arr.push(o)
    groups.set(key, arr)
  }

  let invNum = 1
  let invoiceCount = 0
  for (const [yearMonth, groupOrders] of groups) {
    const billingMonth = `${yearMonth}-01`
    const total = groupOrders.reduce((sum, o) => sum + o.price, 0)

    const [inv] = await db.insert(invoices).values({
      invoice_number: `INV-${String(invNum).padStart(4, '0')}`,
      billing_month: billingMonth,
      total_amount: money(total),
    }).returning({ id: invoices.id })

    for (const o of groupOrders) {
      await db.update(orders)
        .set({ status: 'invoiced', invoice_id: inv!.id })
        .where(eq(orders.id, o.id))
    }
    invNum++
    invoiceCount++
  }
  console.log(`  Seeded ${invoiceCount} invoices (linked to ${[...groups.values()].reduce((s, a) => s + a.length, 0)} orders).`)
}

// ===== Seed: leads =====

interface LeadArchetype {
  name: string
  company: string
  title: string
  status: 'hot' | 'warm' | 'cold'
  daysUntilFollowUp: number | null
  noteCount: number
}

const LEAD_ARCHETYPES: LeadArchetype[] = [
  { name: 'Maria Garcia', company: 'Palmetto Chemicals', title: 'Procurement Director', status: 'hot', daysUntilFollowUp: -5, noteCount: 3 },
  { name: 'James Chen', company: 'Southern Petrochem', title: 'Operations Lead', status: 'hot', daysUntilFollowUp: -2, noteCount: 2 },
  { name: 'Sarah Williams', company: 'Clearwater Distributors', title: 'Owner', status: 'hot', daysUntilFollowUp: 0, noteCount: 1 },
  { name: 'Michael Brown', company: 'Prairie Industries', title: 'GM', status: 'warm', daysUntilFollowUp: 14, noteCount: 1 },
  { name: 'Laura Davis', company: 'East Coast Logistics', title: 'Logistics Manager', status: 'warm', daysUntilFollowUp: -1, noteCount: 2 },
  { name: 'Robert Martinez', company: 'Gulf Supply Co', title: 'Buyer', status: 'warm', daysUntilFollowUp: 7, noteCount: 0 },
  { name: 'Jennifer Lee', company: 'Northwest Containers', title: 'Sourcing Lead', status: 'cold', daysUntilFollowUp: 30, noteCount: 0 },
  { name: 'David Taylor', company: 'Mountain Industrial', title: 'Ops Director', status: 'cold', daysUntilFollowUp: null, noteCount: 1 },
]

async function seedLeads(customerSeeds: SeededCustomer[]): Promise<void> {
  for (const a of LEAD_ARCHETYPES) {
    const followUp = a.daysUntilFollowUp !== null ? isoDate(addDays(TODAY, a.daysUntilFollowUp)) : null
    const [row] = await db.insert(leads).values({
      name: a.name,
      title: a.title,
      company: a.company,
      email: maybe(0.85) ? emailFromCompany(a.name, a.company) : null,
      phone: maybe(0.6) ? `555-${rand(100, 999)}-${rand(1000, 9999)}` : null,
      status: a.status,
      lead_source: pickRandom(LEAD_SOURCES),
      next_follow_up_date: followUp,
      next_action_type: followUp ? pickRandom(['call', 'email', 'visit']) : null,
    }).returning({ id: leads.id })

    for (let i = 0; i < a.noteCount; i++) {
      await db.insert(leadNotes).values({
        lead_id: row!.id,
        content: pickRandom(LEAD_NOTE_SAMPLES),
      })
    }
  }

  // Two converted leads linked to the first two seeded customers.
  let convertedCount = 0
  for (let i = 0; i < 2 && i < customerSeeds.length; i++) {
    const customer = customerSeeds[i]!
    await db.insert(leads).values({
      name: `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`,
      title: 'Owner',
      company: customer.name,
      email: null,
      phone: null,
      status: 'converted',
      lead_source: pickRandom(LEAD_SOURCES),
      converted_customer_id: customer.id,
    })
    convertedCount++
  }

  console.log(`  Seeded ${LEAD_ARCHETYPES.length + convertedCount} leads (${convertedCount} converted).`)
}

// ===== Seed: support tickets =====

async function seedSupport(): Promise<void> {
  for (const t of TICKET_TITLES) {
    await db.insert(supportTickets).values({
      title: t.title,
      category: t.category,
      priority: t.priority,
      description: 'Steps to reproduce: navigate to the relevant screen and follow the title. Blocking daily workflow.',
      status: pickRandom(TICKET_STATUSES),
      developer_notes: maybe(0.5) ? 'Working on a fix — ETA end of week.' : null,
    })
  }
  console.log(`  Seeded ${TICKET_TITLES.length} support tickets.`)
}

// ===== Main =====

async function main() {
  const host = process.env.DATABASE_URL!.split('@')[1]?.split('/')[0] ?? 'unknown'
  console.log(`[seed] Target: ${host}`)

  try {
    console.log('[seed] Wiping existing data...')
    await wipe()

    if (WIPE_ONLY) {
      console.log('[seed] Wipe-only mode. Done.')
      return
    }

    console.log('[seed] Seeding customers...')
    const customerSeeds = await seedCustomers()

    console.log('[seed] Seeding orders...')
    const orderSeeds = await seedOrders(customerSeeds)

    console.log('[seed] Seeding invoices...')
    await seedInvoices(orderSeeds)

    console.log('[seed] Seeding leads...')
    await seedLeads(customerSeeds)

    console.log('[seed] Seeding support tickets...')
    await seedSupport()

    console.log('[seed] Done. Reload the app to see data.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
