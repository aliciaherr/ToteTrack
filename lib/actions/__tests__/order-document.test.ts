import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockCreateSignedUrl = vi.hoisted(() => vi.fn())
const mockStorageFrom = vi.hoisted(() => vi.fn())
const mockGetPath = vi.hoisted(() => vi.fn())

vi.mock('@/db/queries/orders', () => ({ getOrderDocumentPath: mockGetPath }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: { from: mockStorageFrom },
  }),
}))

import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/storage/po-document-url'
import * as orderDocumentActions from '../order-document'
import { getOrderDocumentUrl } from '../order-document'

const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const NO_SESSION = { data: { user: null }, error: null }
const SIGNED = 'https://example.supabase.co/storage/v1/object/sign/po-documents/inbound/a.pdf?token=t'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue(AUTH_OK)
  mockGetPath.mockResolvedValue('inbound/a.pdf')
  mockStorageFrom.mockReturnValue({ createSignedUrl: mockCreateSignedUrl })
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('module surface (SEC-08)', () => {
  it('exports only the action', () => {
    expect(Object.keys(orderDocumentActions)).toEqual(['getOrderDocumentUrl'])
  })
})

describe('getOrderDocumentUrl', () => {
  it('signs an inbound/ document for 1 hour from po-documents with the session client', async () => {
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ url: SIGNED })
    expect(mockGetPath).toHaveBeenCalledWith(ORDER_ID)
    expect(mockStorageFrom).toHaveBeenCalledWith(PO_DOCUMENTS_BUCKET)
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('inbound/a.pdf', SIGNED_URL_EXPIRY_SECONDS)
    expect(SIGNED_URL_EXPIRY_SECONDS).toBe(3600)
  })

  it.each([
    ['a non-inbound key', 'outbound/a.pdf'],
    ['a traversal out of inbound/', 'inbound/../secret.pdf'],
    ['a full URL', 'https://evil.example.com/inbound/a.pdf'],
  ])('never signs %s, logging only the order id (SEC-02, SEC-05)', async (_label, stored) => {
    mockGetPath.mockResolvedValue(stored)
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: 'No PO document on file.' })
    expect(mockCreateSignedUrl).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not an inbound/ key'), { orderId: ORDER_ID })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(stored)
  })

  it('says there is no document for an unknown order or one without a file', async () => {
    mockGetPath.mockResolvedValue(null)
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: 'No PO document on file.' })
    expect(mockCreateSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses a non-UUID id before any query (SEC-02)', async () => {
    expect(await getOrderDocumentUrl('not-a-uuid')).toEqual({ error: 'Invalid order id.' })
    expect(mockGetPath).not.toHaveBeenCalled()
  })

  it('refuses without a session, before any query (SEC-04)', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: 'You are not signed in.' })
    expect(mockGetPath).not.toHaveBeenCalled()
  })

  it('returns the generic error when the auth check throws (SEC-04 inside try)', async () => {
    mockGetUser.mockRejectedValue(new Error('network down'))
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
  })

  it('returns the generic error when signing fails, logging only the id and error name (EH-01, SEC-05)', async () => {
    const storageError = Object.assign(new Error('Object not found: inbound/a.pdf'), { name: 'StorageApiError' })
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: storageError })
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(console.error).toHaveBeenCalledWith('getOrderDocumentUrl: signing the document failed', {
      orderId: ORDER_ID,
      storageError: 'StorageApiError',
    })
  })

  it('returns the generic error when the read throws, logging a parameter-free failure', async () => {
    mockGetPath.mockRejectedValue(new Error('connection reset'))
    expect(await getOrderDocumentUrl(ORDER_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(console.error).toHaveBeenCalledWith('getOrderDocumentUrl: could not load the PO document', {
      orderId: ORDER_ID,
      failure: expect.objectContaining({ error: 'Error' }),
    })
  })
})
