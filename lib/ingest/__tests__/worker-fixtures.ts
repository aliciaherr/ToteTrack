import { vi } from 'vitest'
import type { ClaimedPo } from '@/db/queries/extraction-queue'
import { makePo, SOURCE_TEXT } from '@/lib/checks/__tests__/fixtures'
import type { ExtractedPo } from '@/lib/extraction/types'
import type { CustomerMatch } from '@/lib/matching/types'
import type { WorkerDeps } from '../worker'

// Shared by the worker's unit tests. Every value is invented; no real PO.

export const CONFIG = { apiKey: 'test-key-not-real', model: 'test/model' }
export const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111'
export const MATCHED: CustomerMatch = {
  prefillCustomerId: CUSTOMER_ID,
  candidates: [{ customerId: CUSTOMER_ID, score: 1, nameScore: 1, nameInAddress: false, addressMatched: true, status: 'active' }],
}
export const RENDERED_PAGES = 2

/** A claimed row; a PDF on its first attempt by default. */
export function claimed(overrides: Partial<ClaimedPo> = {}): ClaimedPo {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    source_kind: 'pdf',
    document_path: `inbound/${'a'.repeat(64)}.pdf`,
    body_text: null,
    attempt_count: 1,
    extraction_started_at: new Date('2026-10-12T11:59:00.000Z'),
    ...overrides,
  }
}

/**
 * Deps that succeed for every row. `claimBatch` hands the rows out in order,
 * as many per call as asked. `extractPo` calls the injected renderer
 * for a PDF, as the real one does, so the page count is observable.
 */
export function makeDeps(
  rows: ClaimedPo[],
  overrides: Partial<WorkerDeps> = {},
  reading: { extracted: ExtractedPo; sourceText: string[] | null } = { extracted: makePo(), sourceText: SOURCE_TEXT },
): WorkerDeps {
  const queue = [...rows]
  return {
    readConfig: () => CONFIG,
    claimBatch: vi.fn(async (limit: number) => queue.splice(0, limit)),
    completeExtraction: vi.fn().mockResolvedValue(undefined),
    failExtraction: vi.fn().mockResolvedValue(undefined),
    releaseForRetry: vi.fn().mockResolvedValue(undefined),
    downloadPoDocument: vi.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    extractPo: vi.fn(async (input, _config, deps) => {
      if (input.kind === 'pdf') await deps.renderPdfPages(input.bytes, RENDERED_PAGES)
      return reading
    }),
    extractionDeps: {
      fetchImpl: vi.fn(),
      renderPdfPages: vi.fn().mockResolvedValue({
        images: Array.from({ length: RENDERED_PAGES }, () => Buffer.from('png')),
        text: Array.from({ length: RENDERED_PAGES }, () => ''),
      }),
    },
    matchCustomer: vi.fn().mockResolvedValue(MATCHED),
    now: () => new Date('2026-10-12T12:00:00.000Z'),
    ...overrides,
  }
}
