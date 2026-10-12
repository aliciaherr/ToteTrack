import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db', () => ({ db: {} }))

import { DatabaseError } from '@/lib/errors'
import {
  ExtractionConfigError,
  ExtractionResponseError,
  OpenRouterTimeoutError,
  PdfTooManyPagesError,
} from '@/lib/extraction/errors'
import { StorageConfigError } from '@/lib/storage/errors'
import {
  EXTRACTION_CLAIM_CUTOFF_MS,
  EXTRACTION_LEASE_MS,
  EXTRACTION_RETRY_DELAY_MS,
  INGEST_BATCH_SIZE,
  MAX_EXTRACTION_ATTEMPTS,
} from '../ingest.constants'
import { drainExtractionBatch } from '../worker'
import { CONFIG, CUSTOMER_ID, claimed, makeDeps } from './worker-fixtures'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const failureOf = (detail: string) => expect.objectContaining({
  failures: [{ check: 'extraction_failed', field: 'document', detail }],
})

describe('drainExtractionBatch — happy path', () => {
  it('claims one row at a time with the lease and retry delay, and completes a PDF', async () => {
    const row = claimed()
    const deps = makeDeps([row])

    const summary = await drainExtractionBatch(deps)

    expect(deps.claimBatch).toHaveBeenCalledWith(
      1,
      { leaseMs: EXTRACTION_LEASE_MS, retryDelayMs: EXTRACTION_RETRY_DELAY_MS },
      expect.any(Date),
    )
    expect(deps.downloadPoDocument).toHaveBeenCalledWith(row.document_path)
    expect(deps.completeExtraction).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ isPurchaseOrder: true }),
      expect.objectContaining({ version: 1, customerMatch: expect.objectContaining({ prefillCustomerId: CUSTOMER_ID }) }),
    )
    expect(summary).toEqual({ claimed: 1, rowsMayRemain: false, completed: 1, failed: 0, released: 0, stranded: 0 })
  })

  it('reads an email body from body_text and never downloads', async () => {
    const deps = makeDeps([claimed({ source_kind: 'email_body', document_path: null, body_text: 'po text' })])

    await drainExtractionBatch(deps)

    expect(deps.downloadPoDocument).not.toHaveBeenCalled()
    expect(deps.extractPo).toHaveBeenCalledWith({ kind: 'text', text: 'po text' }, CONFIG, expect.anything())
  })

  it('appends the customer-match failure to the check failures', async () => {
    const deps = makeDeps([claimed()], { matchCustomer: vi.fn().mockResolvedValue({ prefillCustomerId: null, candidates: [] }) })

    await drainExtractionBatch(deps)

    const [, , results] = vi.mocked(deps.completeExtraction).mock.calls[0]
    expect(results.failures.map((failure) => failure.check)).toContain('no_customer_match')
  })

  it('stops at INGEST_BATCH_SIZE and reports rows may remain; an empty queue reports none', async () => {
    const more = Array.from({ length: INGEST_BATCH_SIZE + 1 }, (_, i) => claimed({ id: `row-${i}` }))
    expect(await drainExtractionBatch(makeDeps(more))).toMatchObject({ claimed: INGEST_BATCH_SIZE, rowsMayRemain: true })
    expect(await drainExtractionBatch(makeDeps([]))).toMatchObject({ claimed: 0, rowsMayRemain: false })
  })

  it('claims no new row once the cutoff has passed (MEDIUM-09)', async () => {
    let clock = Date.parse('2026-10-12T12:00:00.000Z')
    const rows = [claimed({ id: 'slow' }), claimed({ id: 'never' })]
    const deps = makeDeps(rows, { now: () => new Date(clock) })
    const succeeding = deps.extractPo
    deps.extractPo = vi.fn(async (...args: Parameters<typeof succeeding>) => {
      clock += EXTRACTION_CLAIM_CUTOFF_MS
      return succeeding(...args)
    })

    const summary = await drainExtractionBatch(deps)

    expect(summary).toMatchObject({ claimed: 1, completed: 1, rowsMayRemain: true })
    expect(deps.claimBatch).toHaveBeenCalledTimes(1)
  })
})

describe('drainExtractionBatch — failures', () => {
  it('parks a row over the attempt limit without loading or rendering it (M-04 condition 2)', async () => {
    const deps = makeDeps([claimed({ attempt_count: MAX_EXTRACTION_ATTEMPTS + 1 })])

    const summary = await drainExtractionBatch(deps)

    expect(deps.downloadPoDocument).not.toHaveBeenCalled()
    expect(deps.extractPo).not.toHaveBeenCalled()
    expect(deps.failExtraction).toHaveBeenCalledWith(expect.any(String), failureOf('ExtractionAttemptsExhaustedError'))
    expect(summary.failed).toBe(1)
  })

  it.each([
    ['PdfTooManyPagesError', new PdfTooManyPagesError(30, 10)],
    ['ExtractionResponseError', new ExtractionResponseError('test/model', 'lines: Required')],
  ])('ends a planted permanent error (%s) at extraction_failed in one run', async (name, error) => {
    const deps = makeDeps([claimed({ attempt_count: 1 })], { extractPo: vi.fn().mockRejectedValue(error) })

    await drainExtractionBatch(deps)

    expect(deps.failExtraction).toHaveBeenCalledWith(expect.any(String), failureOf(name))
    expect(deps.releaseForRetry).not.toHaveBeenCalled()
  })

  it('parks a row with nothing to read as permanent', async () => {
    const deps = makeDeps([claimed({ source_kind: 'email_body', document_path: null, body_text: null })])
    await drainExtractionBatch(deps)
    expect(deps.failExtraction).toHaveBeenCalledWith(expect.any(String), failureOf('MissingExtractionInputError'))
  })

  it('releases a transient error for retry while attempts remain', async () => {
    const deps = makeDeps([claimed({ attempt_count: 1 })], {
      extractPo: vi.fn().mockRejectedValue(new OpenRouterTimeoutError('test/model', 1000)),
    })

    const summary = await drainExtractionBatch(deps)

    expect(deps.releaseForRetry).toHaveBeenCalledTimes(1)
    expect(deps.failExtraction).not.toHaveBeenCalled()
    expect(summary.released).toBe(1)
  })

  it('parks a transient error on the last attempt instead of releasing it', async () => {
    const deps = makeDeps([claimed({ attempt_count: MAX_EXTRACTION_ATTEMPTS })], {
      matchCustomer: vi.fn().mockRejectedValue(new DatabaseError('findCustomerCandidates', 'down')),
    })

    await drainExtractionBatch(deps)

    expect(deps.failExtraction).toHaveBeenCalledWith(expect.any(String), failureOf('DatabaseError'))
    expect(deps.releaseForRetry).not.toHaveBeenCalled()
  })

  it('keeps going after one row fails', async () => {
    const deps = makeDeps([claimed({ id: 'first' }), claimed({ id: 'second' })])
    const succeeding = deps.extractPo
    deps.extractPo = vi.fn()
      .mockRejectedValueOnce(new OpenRouterTimeoutError('test/model', 1000))
      .mockImplementation(succeeding)

    const summary = await drainExtractionBatch(deps)

    expect(summary).toMatchObject({ released: 1, completed: 1 })
  })

  it('reports a row as stranded when even the failure write fails', async () => {
    const deps = makeDeps([claimed()], {
      extractPo: vi.fn().mockRejectedValue(new OpenRouterTimeoutError('test/model', 1000)),
      releaseForRetry: vi.fn().mockRejectedValue(new DatabaseError('releaseForRetry', 'down')),
    })

    expect((await drainExtractionBatch(deps)).stranded).toBe(1)
  })
})

describe('drainExtractionBatch — configuration errors stop the batch', () => {
  it('reads the config before claiming, so a missing key costs no row an attempt', async () => {
    const deps = makeDeps([claimed()], {
      readConfig: () => { throw new ExtractionConfigError('OPENROUTER_API_KEY', 'is missing') },
    })

    await expect(drainExtractionBatch(deps)).rejects.toBeInstanceOf(ExtractionConfigError)
    expect(deps.claimBatch).not.toHaveBeenCalled()
  })

  it('releases the in-flight row, claims nothing more, and rethrows on a storage config error', async () => {
    const rows = [claimed({ id: 'one' }), claimed({ id: 'two' }), claimed({ id: 'three' })]
    const deps = makeDeps(rows, {
      downloadPoDocument: vi.fn()
        .mockResolvedValueOnce(Buffer.from('%PDF'))
        .mockRejectedValueOnce(new StorageConfigError('SUPABASE_SECRET_KEY')),
    })

    await expect(drainExtractionBatch(deps)).rejects.toBeInstanceOf(StorageConfigError)

    expect(deps.completeExtraction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.releaseForRetry).mock.calls.map(([id]) => id)).toEqual(['two'])
    expect(deps.claimBatch).toHaveBeenCalledTimes(2)
  })
})
