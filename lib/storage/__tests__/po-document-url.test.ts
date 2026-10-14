import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreateClient = vi.hoisted(() => vi.fn())
const mockCreateSignedUrl = vi.hoisted(() => vi.fn())
const mockStorageFrom = vi.hoisted(() => vi.fn())

// CONSTRAINT-38: the only client this module may use is the session one.
vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))

import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'
import { NOT_INBOUND_PATH, SIGNED_URL_EXPIRY_SECONDS, signPoDocument } from '../po-document-url'

const SIGNED = 'https://example.supabase.co/storage/v1/object/sign/po-documents/inbound/a.pdf?token=t'

beforeEach(() => {
  mockCreateClient.mockResolvedValue({ storage: { from: mockStorageFrom } })
  mockStorageFrom.mockReturnValue({ createSignedUrl: mockCreateSignedUrl })
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('signPoDocument', () => {
  it('signs an inbound/ key for 1 hour with the session client', async () => {
    expect(await signPoDocument('inbound/a.pdf')).toEqual({ url: SIGNED })
    expect(mockStorageFrom).toHaveBeenCalledWith(PO_DOCUMENTS_BUCKET)
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('inbound/a.pdf', SIGNED_URL_EXPIRY_SECONDS)
  })

  it.each([
    ['a non-inbound key', 'outbound/a.pdf'],
    ['a traversal out of inbound/', 'inbound/../secret.pdf'],
    ['a full URL', 'https://evil.example.com/inbound/a.pdf'],
    ['the bare folder', 'inbound/'],
  ])('refuses %s before any client is made (SEC-02)', async (_label, path) => {
    expect(await signPoDocument(path)).toEqual({ storageError: NOT_INBOUND_PATH })
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockCreateSignedUrl).not.toHaveBeenCalled()
  })

  it("returns the Storage error's name, never its message", async () => {
    const error = Object.assign(new Error('Object not found: inbound/a.pdf'), { name: 'StorageApiError' })
    mockCreateSignedUrl.mockResolvedValue({ data: null, error })
    expect(await signPoDocument('inbound/a.pdf')).toEqual({ storageError: 'StorageApiError' })
  })

  it('returns a null storageError when Storage gives no URL and no error', async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: null })
    expect(await signPoDocument('inbound/a.pdf')).toEqual({ storageError: null })
  })
})
