import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'

/**
 * `customer-match` against the local Supabase Postgres (TS-03): real pg_trgm
 * and the migration 0020 normalisers. Needs the stack running and 0020
 * applied: `npm run test:integration`.
 *
 * Skipped, visibly, when `DATABASE_URL` is unset. When set,
 * `requireLocalDatabaseUrl` throws on any host but localhost. The customers
 * below carry a made-up word ("Qwvz") so no other local row matches them, and
 * are deleted by ID afterwards (their addresses cascade).
 */

type Queries = typeof import('../customer-match')
type Db = typeof import('@/db')['db']

describe.skipIf(!process.env.DATABASE_URL)('customer-match (local Postgres)', () => {
  let queries: Queries
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  const ids: Record<string, string> = {}

  async function insertCustomer(key: string, name: string, status: 'active' | 'inactive', address?: string) {
    const [row] = (await db.execute(sql`
      INSERT INTO customers (company_name, status) VALUES (${name}, ${status}) RETURNING id
    `)) as unknown as { id: string }[]
    ids[key] = row.id
    if (address) await db.execute(sql`INSERT INTO customer_addresses (customer_id, address) VALUES (${row.id}, ${address})`)
  }

  const normaliseName = async (value: string) =>
    ((await db.execute(sql`SELECT public.normalise_company_name(${value}::text) AS v`)) as unknown as { v: string }[])[0].v

  beforeAll(async () => {
    requireLocalDatabaseUrl('customer-match.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    queries = await import('../customer-match')
    await insertCustomer('acme', 'Qwvz Acme Totes, Inc.', 'active', '400 Industrial Parkway, Suite 2, Joliet IL 60431')
    await insertCustomer('nickname', 'Qwvz Delta Energy/Rhenium', 'active', 'Qwvz Rhenium Lubricants and Specialty Chemical 733 Keyser Avenue Ste 200 Natchitoches, LA 71457')
    await insertCustomer('twinA', 'Qwvz Twin Holdings LLC', 'active')
    await insertCustomer('twinB', 'QWVZ Twin Holdings, Corp.', 'inactive')
  })

  afterAll(async () => {
    const created = Object.values(ids)
    if (db && created.length > 0) {
      await db.execute(sql`DELETE FROM customers WHERE id IN (${sql.join(created.map((id) => sql`${id}`), sql`, `)})`)
    }
  })

  const byId = (rows: Awaited<ReturnType<Queries['findCustomerCandidates']>>, key: string) =>
    rows.find((row) => row.customerId === ids[key])

  it('normalises case, &, apostrophes, punctuation, a leading "The" and US suffixes', async () => {
    expect(await normaliseName('The Acme & Sons, Inc.')).toBe('acme and sons')
    expect(await normaliseName("Joe's Totes, LLC")).toBe('joes totes')
    expect(await normaliseName('Dakota Co. Inc')).toBe('dakota')
    expect(await normaliseName('Company')).toBe('company')
    expect(await normaliseName('Dakota Distributing ,L.L.C.')).toBe('dakota distributing')
    expect(await normaliseName('Alvar, Inc. (NF)')).toBe('alvar')
    expect(await normaliseName('Alliance Chemical- NF')).toBe('alliance chemical')
  })

  it('flags an exact normalised name and scores it 1', async () => {
    const rows = await queries.findCustomerCandidates('THE QWVZ ACME TOTES LLC', null)
    expect(byId(rows, 'acme')).toMatchObject({ exactName: true, nameScore: 1, status: 'active' })
  })

  it('returns both customers that share a normalised name, with their status', async () => {
    const rows = await queries.findCustomerCandidates('Qwvz Twin Holdings', null)
    expect(byId(rows, 'twinA')?.exactName).toBe(true)
    expect(byId(rows, 'twinB')).toMatchObject({ exactName: true, status: 'inactive' })
  })

  it('finds a fuzzy name without calling it exact', async () => {
    const rows = await queries.findCustomerCandidates('Qwvz Acme Tote', null)
    const acme = byId(rows, 'acme')
    expect(acme?.exactName).toBe(false)
    expect(acme?.nameScore).toBeGreaterThan(0.3)
  })

  it('finds a customer by saved address alone, with abbreviations unified', async () => {
    const rows = await queries.findCustomerCandidates(null, '400 Industrial Pkwy Ste 2 Joliet, IL 60431')
    const acme = byId(rows, 'acme')
    expect(acme).toMatchObject({ nameScore: 0, exactName: false })
    expect(acme?.addressScore).toBeGreaterThan(0.9)
  })

  it('finds a customer whose saved address opens with the PO name, without calling it exact', async () => {
    const rows = await queries.findCustomerCandidates('QWVZ RHENIUM LUBRICANTS', null)
    const nickname = byId(rows, 'nickname')
    expect(nickname?.exactName).toBe(false)
    expect(nickname?.nameInAddressScore).toBeGreaterThan(0.9)
  })

  it('matches nothing for a name that normalises to nothing', async () => {
    const rows = await queries.findCustomerCandidates('Inc.', null)
    expect(rows.some((row) => row.exactName)).toBe(false)
  })

  it('returns no candidates for an unrelated name and address', async () => {
    const rows = await queries.findCustomerCandidates('Zyxx Unrelated Freight', '9 Nowhere Lane, Fargo ND')
    expect(Object.keys(ids).some((key) => byId(rows, key))).toBe(false)
  })
})
