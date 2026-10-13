import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'
import type { CreateOrderInput } from '../orders.validation'

/**
 * The review decisions against the local Supabase Postgres (TS-03): the
 * approve transaction end to end, and the Skip / Delete writes. Needs the
 * stack running: `npm run test:integration`. Skipped, visibly, when
 * `DATABASE_URL` is unset. The session and `revalidatePath` are mocked; the
 * database is real. Every row is this file's own (its UIDVALIDITY, its PO
 * number prefix, its customer) and is deleted afterwards.
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_108
const PO_PREFIX = 'QWVZ108-'
const ALREADY_HANDLED = 'This PO was already handled.'

// Flipped by the rollback test: makes `markApproved` throw after the insert.
const failMarkApproved = vi.hoisted(() => ({ on: false }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } }),
}))
vi.mock('@/db/queries/review-decisions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/review-decisions')>()
  return {
    ...actual,
    markApproved: async (...args: Parameters<typeof actual.markApproved>) => {
      if (failMarkApproved.on) throw new Error('forced failure after the insert')
      return actual.markApproved(...args)
    },
  }
})

type Db = typeof import('@/db')['db']
type Actions = typeof import('../review-decisions')
type PoState = { status: string; order_id: string | null; confirmed: unknown; skipped_at: unknown }

describe.skipIf(!process.env.DATABASE_URL)('review decisions (local Postgres)', () => {
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  let actions: Actions
  let customerId: string
  let emailId: string

  async function removeTestRows() {
    await db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)
    await db.execute(sql`DELETE FROM orders WHERE po_number LIKE ${PO_PREFIX + '%'}`)
    await db.execute(sql`DELETE FROM customers WHERE company_name = 'Qwvz Decisions Dormant'`)
  }

  async function insertPo(documentPath: string | null): Promise<string> {
    const kind = documentPath ? 'pdf' : 'email_body'
    const body = documentPath ? null : 'please ship 10 totes'
    const [row] = (await db.execute(sql`
      INSERT INTO inbound_pos (inbound_email_id, source_kind, document_path, body_text, content_hash, status)
      VALUES (${emailId}, ${kind}, ${documentPath}, ${body}, ${crypto.randomUUID()}, 'pending_review')
      RETURNING id
    `)) as unknown as { id: string }[]
    return row.id
  }

  const poState = async (id: string): Promise<PoState> =>
    ((await db.execute(sql`
      SELECT status, order_id, confirmed, skipped_at FROM inbound_pos WHERE id = ${id}
    `)) as unknown as PoState[])[0]

  const ordersFor = async (poNumber: string) =>
    (await db.execute(sql`
      SELECT id, document_url FROM orders WHERE po_number = ${poNumber}
    `)) as unknown as { id: string; document_url: string | null }[]

  const customerStatus = async () =>
    ((await db.execute(sql`SELECT status FROM customers WHERE id = ${customerId}`)) as unknown as { status: string }[])[0]
      .status

  function form(poNumber: string): CreateOrderInput {
    return {
      po_number: poNumber,
      customer_id: customerId,
      qty_275_recon: 0,
      qty_275_rebot: 10,
      qty_275_new: 0,
      qty_330_recon: 0,
      qty_330_rebot: 0,
      qty_330_new: 0,
      unit_price_275_recon: null,
      unit_price_275_rebot: 25,
      unit_price_275_new: null,
      unit_price_330_recon: null,
      unit_price_330_rebot: null,
      unit_price_330_new: null,
      customer_collects: false,
      delivery_address: '9 Decision Rd, Testville',
      requested_delivery_date: '2026-11-02',
      backhaul: false,
      notes: null,
    }
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('review-decisions.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    actions = await import('../review-decisions')
    await removeTestRows()
  })

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failMarkApproved.on = false
    await removeTestRows()
    ;[{ id: customerId }] = (await db.execute(sql`
      INSERT INTO customers (company_name, status) VALUES ('Qwvz Decisions Dormant', 'inactive') RETURNING id
    `)) as unknown as { id: string }[]
    ;[{ id: emailId }] = (await db.execute(sql`
      INSERT INTO inbound_emails (uid_validity, uid, classification) VALUES (${TEST_VALIDITY}, 1, 'po_found') RETURNING id
    `)) as unknown as { id: string }[]
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    if (db) await removeTestRows()
  })

  it('approves: one order linked to the document, PO approved with what was submitted, customer reactivated', async () => {
    const poId = await insertPo('inbound/qwvz108.pdf')
    const submitted = form(`${PO_PREFIX}1`)

    const result = await actions.approveReviewPo(poId, submitted)

    expect(result).toEqual({ orderId: expect.any(String), reactivated: true })
    const [order] = await ordersFor(submitted.po_number)
    expect(order).toEqual({ id: (result as { orderId: string }).orderId, document_url: 'inbound/qwvz108.pdf' })
    expect(await poState(poId)).toMatchObject({ status: 'approved', order_id: order.id, confirmed: submitted })
    expect(await customerStatus()).toBe('active')
  })

  it('links no document for an email-body PO and reports no reactivation for an active customer', async () => {
    await db.execute(sql`UPDATE customers SET status = 'active' WHERE id = ${customerId}`)
    const poId = await insertPo(null)
    expect(await actions.approveReviewPo(poId, form(`${PO_PREFIX}2`))).toMatchObject({ reactivated: false })
    expect((await ordersFor(`${PO_PREFIX}2`))[0].document_url).toBeNull()
  })

  it('refuses a PO number that already exists and leaves the PO queued, unchanged', async () => {
    const first = await insertPo('inbound/a.pdf')
    const second = await insertPo('inbound/b.pdf')
    expect(await actions.approveReviewPo(first, form(`${PO_PREFIX}3`))).toHaveProperty('orderId')

    expect(await actions.approveReviewPo(second, form(`${PO_PREFIX}3`))).toEqual({ error: 'PO number already exists.' })
    expect(await poState(second)).toMatchObject({ status: 'pending_review', order_id: null, confirmed: null })
    expect(await ordersFor(`${PO_PREFIX}3`)).toHaveLength(1)
  })

  it('refuses a second approve of the same PO: one order only', async () => {
    const poId = await insertPo('inbound/c.pdf')
    expect(await actions.approveReviewPo(poId, form(`${PO_PREFIX}4`))).toHaveProperty('orderId')
    expect(await actions.approveReviewPo(poId, form(`${PO_PREFIX}5`))).toEqual({ error: ALREADY_HANDLED })
    expect(await ordersFor(`${PO_PREFIX}5`)).toHaveLength(0)
  })

  it('serializes two concurrent approves of one PO onto one order', async () => {
    const poId = await insertPo('inbound/d.pdf')
    const results = await Promise.all([
      actions.approveReviewPo(poId, form(`${PO_PREFIX}6`)),
      actions.approveReviewPo(poId, form(`${PO_PREFIX}7`)),
    ])
    expect(results.filter((result) => 'orderId' in result)).toHaveLength(1)
    expect(results).toContainEqual({ error: ALREADY_HANDLED })
    const created = [...(await ordersFor(`${PO_PREFIX}6`)), ...(await ordersFor(`${PO_PREFIX}7`))]
    expect(created).toHaveLength(1)
  })

  it('rolls the order and the reactivation back when a later write fails', async () => {
    const poId = await insertPo('inbound/e.pdf')
    failMarkApproved.on = true

    expect(await actions.approveReviewPo(poId, form(`${PO_PREFIX}8`))).toEqual({
      error: 'Something went wrong. Please try again.',
    })
    expect(await ordersFor(`${PO_PREFIX}8`)).toHaveLength(0)
    expect(await poState(poId)).toMatchObject({ status: 'pending_review', order_id: null })
    expect(await customerStatus()).toBe('inactive')
  })

  it('skip stamps skipped_at and keeps the PO queued; a decided PO is already handled', async () => {
    const poId = await insertPo('inbound/f.pdf')
    expect(await actions.skipReviewPo(poId)).toEqual({ success: true })
    const state = await poState(poId)
    expect(state.status).toBe('pending_review')
    expect(state.skipped_at).not.toBeNull()

    expect(await actions.discardReviewPo(poId)).toEqual({ success: true })
    expect(await actions.skipReviewPo(poId)).toEqual({ error: ALREADY_HANDLED })
  })

  it('discard sets discarded, keeps the row, and cannot be repeated or approved', async () => {
    const poId = await insertPo('inbound/g.pdf')
    expect(await actions.discardReviewPo(poId)).toEqual({ success: true })
    expect(await poState(poId)).toMatchObject({ status: 'discarded', order_id: null })

    expect(await actions.discardReviewPo(poId)).toEqual({ error: ALREADY_HANDLED })
    expect(await actions.approveReviewPo(poId, form(`${PO_PREFIX}9`))).toEqual({ error: ALREADY_HANDLED })
    expect(await ordersFor(`${PO_PREFIX}9`)).toHaveLength(0)
  })
})
