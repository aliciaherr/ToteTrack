import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'

/**
 * The order detail's `source_kind` and the document-path read against the
 * local Supabase Postgres (TS-03, Task 121). Needs the stack running:
 * `npm run test:integration`. Skipped, visibly, when `DATABASE_URL` is unset.
 * Every row is this file's own (its UIDVALIDITY, its PO number prefix, its
 * customer) and is deleted afterwards.
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_121
const PO_PREFIX = 'QWVZ121-'
const CUSTOMER_NAME = 'Qwvz Order Document'

type Db = typeof import('@/db')['db']
type Queries = typeof import('../orders')
type SourceKind = 'pdf' | 'image' | 'email_body'

describe.skipIf(!process.env.DATABASE_URL)('order detail source_kind (local Postgres)', () => {
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  let queries: Queries
  let customerId: string
  let emailId: string

  async function removeTestRows() {
    await db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)
    await db.execute(sql`DELETE FROM orders WHERE po_number LIKE ${PO_PREFIX + '%'}`)
    await db.execute(sql`DELETE FROM customers WHERE company_name = ${CUSTOMER_NAME}`)
  }

  async function insertOrder(suffix: string, documentUrl: string | null): Promise<string> {
    const [row] = (await db.execute(sql`
      INSERT INTO orders (po_number, customer_id, price, document_url)
      VALUES (${PO_PREFIX + suffix}, ${customerId}, 0, ${documentUrl})
      RETURNING id
    `)) as unknown as { id: string }[]
    return row.id
  }

  async function insertPo(kind: SourceKind, status: string, orderId: string | null) {
    const path = kind === 'email_body' ? null : `inbound/qwvz121-${crypto.randomUUID()}.pdf`
    const body = kind === 'email_body' ? 'please ship 10 totes' : null
    await db.execute(sql`
      INSERT INTO inbound_pos (inbound_email_id, source_kind, document_path, body_text, content_hash, status, order_id)
      VALUES (${emailId}, ${kind}, ${path}, ${body}, ${crypto.randomUUID()}, ${status}, ${orderId})
    `)
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('orders.detail.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    queries = await import('../orders')
    await removeTestRows()
  })

  beforeEach(async () => {
    await removeTestRows()
    ;[{ id: customerId }] = (await db.execute(sql`
      INSERT INTO customers (company_name) VALUES (${CUSTOMER_NAME}) RETURNING id
    `)) as unknown as { id: string }[]
    ;[{ id: emailId }] = (await db.execute(sql`
      INSERT INTO inbound_emails (uid_validity, uid, classification) VALUES (${TEST_VALIDITY}, 1, 'po_found') RETURNING id
    `)) as unknown as { id: string }[]
  })

  afterAll(async () => {
    if (db) await removeTestRows()
  })

  it.each<SourceKind>(['pdf', 'image', 'email_body'])('reports %s for an order approved from that kind of PO', async (kind) => {
    const orderId = await insertOrder(kind, kind === 'email_body' ? null : 'inbound/qwvz121.pdf')
    await insertPo(kind, 'approved', orderId)
    expect((await queries.getOrderDetail(orderId)).source_kind).toBe(kind)
  })

  it('reports null for an order not created from Review', async () => {
    const orderId = await insertOrder('manual', null)
    expect((await queries.getOrderDetail(orderId)).source_kind).toBeNull()
  })

  it('reads the stored document key, and null for an order without one', async () => {
    const withDocument = await insertOrder('doc', 'inbound/qwvz121.pdf')
    const without = await insertOrder('nodoc', null)
    expect(await queries.getOrderDocumentPath(withDocument)).toBe('inbound/qwvz121.pdf')
    expect(await queries.getOrderDocumentPath(without)).toBeNull()
    expect(await queries.getOrderDocumentPath(crypto.randomUUID())).toBeNull()
  })
})
