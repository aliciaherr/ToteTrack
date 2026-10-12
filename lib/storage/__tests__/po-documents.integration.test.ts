// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'

/**
 * `po-documents` against the local Supabase Storage (TS-03): the real bucket,
 * its MIME allow-list and the secret key. Needs the stack running and
 * `SUPABASE_SECRET_KEY` in `.env` (`npx supabase status` → SECRET_KEY):
 * `npm run test:integration`.
 *
 * Skipped, visibly, when the key is unset — `npm test` does not load `.env`.
 * Refuses any project URL but localhost, so it can never write to prod.
 *
 * The module deliberately exposes no delete (CONSTRAINT-38), so the test
 * writes one fixed key and overwrites it every run: nothing accumulates.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const TEST_PATH = 'inbound/task-103-integration-round-trip.pdf'
const MISSING_PATH = 'inbound/task-103-integration-never-written.pdf'

type Storage = typeof import('../po-documents')
type Errors = typeof import('../errors')

describe.skipIf(!process.env.SUPABASE_SECRET_KEY)('po-documents (local Storage)', () => {
  let storage: Storage
  let errors: Errors

  beforeAll(async () => {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`po-documents.integration.test refuses a non-local Supabase URL (host ${host})`)
    }
    storage = await import('../po-documents')
    errors = await import('../errors')
  })

  it('round-trips the bytes, and a second upload to the same key succeeds (MEDIUM-06)', async () => {
    const first = Buffer.from(`%PDF-1.4 first ${Date.now()}`)
    const second = Buffer.from(`%PDF-1.4 second ${Date.now()}`)

    await storage.uploadPoDocument(TEST_PATH, first, 'application/pdf')
    expect(Buffer.compare(await storage.downloadPoDocument(TEST_PATH), first)).toBe(0)

    await storage.uploadPoDocument(TEST_PATH, second, 'application/pdf')
    expect(Buffer.compare(await storage.downloadPoDocument(TEST_PATH), second)).toBe(0)
  })

  it('a missing object throws PoDocumentStorageError naming the path', async () => {
    const thrown = await storage.downloadPoDocument(MISSING_PATH).catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(errors.PoDocumentStorageError)
    expect((thrown as Error).message).toContain(MISSING_PATH)
  })
})
