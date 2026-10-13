import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockCreateSignedUrl = vi.hoisted(() => vi.fn())
const mockStorageFrom = vi.hoisted(() => vi.fn())
const mockListIds = vi.hoisted(() => vi.fn())
const mockGetRow = vi.hoisted(() => vi.fn())

vi.mock('@/db/queries/review-source', () => ({
  listReviewQueueIds: mockListIds,
  getReviewSourceRow: mockGetRow,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: { from: mockStorageFrom },
  }),
}))

import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import * as reviewActions from '../review'
import { getReviewQueue, getReviewSource } from '../review'

const PO_ID = '22222222-2222-2222-2222-222222222222'
const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const NO_SESSION = { data: { user: null }, error: null }
const SIGNED = 'https://example.supabase.co/storage/v1/object/sign/po-documents/inbound/a.pdf?token=t'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    source_kind: 'pdf',
    document_path: 'inbound/a.pdf',
    body_text: null,
    check_results: null,
    from_address: 'buyer@example.com',
    subject: 'PO 4471',
    received_at: null,
    message_id: '<m1@example.com>',
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue(AUTH_OK)
  mockStorageFrom.mockReturnValue({ createSignedUrl: mockCreateSignedUrl })
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('module surface (SEC-08)', () => {
  it('exports only the two actions', () => {
    expect(Object.keys(reviewActions).sort()).toEqual(['getReviewQueue', 'getReviewSource'])
  })
})

describe('getReviewQueue', () => {
  it('returns the ids in review order', async () => {
    mockListIds.mockResolvedValue(['a', 'b'])
    expect(await getReviewQueue()).toEqual({ ids: ['a', 'b'] })
  })

  it('refuses without a session, before any query (SEC-04)', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    expect(await getReviewQueue()).toHaveProperty('error')
    expect(mockListIds).not.toHaveBeenCalled()
  })

  it('returns the generic error when the read fails', async () => {
    mockListIds.mockRejectedValue(new Error('down'))
    expect(await getReviewQueue()).toEqual({ error: GENERIC_FAILURE_MESSAGE })
  })
})

describe('getReviewSource', () => {
  it.each(['pdf', 'image'])('signs a %s for 1 hour in the po-documents bucket', async (kind) => {
    mockGetRow.mockResolvedValue(row({ source_kind: kind }))

    expect(await getReviewSource(PO_ID)).toEqual({ source: { kind, url: SIGNED } })
    expect(mockStorageFrom).toHaveBeenCalledWith('po-documents')
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('inbound/a.pdf', 3600)
  })

  it('returns the text of an email-body PO without signing anything', async () => {
    mockGetRow.mockResolvedValue(row({ source_kind: 'email_body', document_path: null, body_text: 'PO 4471' }))

    expect(await getReviewSource(PO_ID)).toEqual({ source: { kind: 'text', text: 'PO 4471' } })
    expect(mockCreateSignedUrl).not.toHaveBeenCalled()
  })

  it('returns the refusal of a refused row', async () => {
    const failures = [{ check: 'ingest_limit', reason: 'staging_failed', part: 'message' }]
    mockGetRow.mockResolvedValue(row({ source_kind: 'email_body', document_path: null, check_results: { failures } }))

    const result = await getReviewSource(PO_ID)
    expect(result).toMatchObject({ source: { kind: 'refused', refusal: { title: "Couldn't be imported" } } })
  })

  it('refuses without a session (SEC-04)', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    expect(await getReviewSource(PO_ID)).toHaveProperty('error')
    expect(mockGetRow).not.toHaveBeenCalled()
  })

  it('refuses a non-UUID id before any query (SEC-02)', async () => {
    expect(await getReviewSource("1' OR '1'='1")).toEqual({ error: 'Invalid PO id.' })
    expect(mockGetRow).not.toHaveBeenCalled()
  })

  it('says so when the PO is not found', async () => {
    mockGetRow.mockResolvedValue(null)
    expect(await getReviewSource(PO_ID)).toEqual({ error: 'This PO is no longer in the review queue.' })
  })

  it('returns the generic error when signing fails, logging only the id (SEC-05)', async () => {
    mockGetRow.mockResolvedValue(row())
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { name: 'StorageApiError', message: 'inbound/a.pdf not found' } })

    expect(await getReviewSource(PO_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(console.error).toHaveBeenCalledWith('getReviewSource: signing the document failed', {
      poId: PO_ID,
      storageError: 'StorageApiError',
    })
  })

  it('returns the generic error for a file row with no path', async () => {
    mockGetRow.mockResolvedValue(row({ document_path: null }))
    expect(await getReviewSource(PO_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
  })

  it('returns the generic error when the read throws', async () => {
    mockGetRow.mockRejectedValue(new Error('down'))
    expect(await getReviewSource(PO_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
  })
})
