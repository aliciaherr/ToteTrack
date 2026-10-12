import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockUpload = vi.hoisted(() => vi.fn())
const mockDownload = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
const mockCreateClient = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }))

import { downloadPoDocument, uploadPoDocument } from '../po-documents'
import { PoDocumentStorageError, StorageConfigError } from '../errors'
import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'

const KEY_VARIABLE = 'SUPABASE_SECRET_KEY'
const PATH = `inbound/${'a'.repeat(64)}.pdf`
// Stands in for document content: it must never reach an error message.
const DOCUMENT = Buffer.from('PO 4471 — 300 totes, ship to Joliet')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv(KEY_VARIABLE, 'sb_secret_test_placeholder')
  mockFrom.mockReturnValue({ upload: mockUpload, download: mockDownload })
  mockCreateClient.mockReturnValue({ storage: { from: mockFrom } })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('uploadPoDocument', () => {
  it('uploads to the po-documents bucket with upsert, so a re-upload overwrites (MEDIUM-06)', async () => {
    mockUpload.mockResolvedValueOnce({ data: { path: PATH }, error: null })

    await uploadPoDocument(PATH, DOCUMENT, 'application/pdf')

    expect(mockFrom).toHaveBeenCalledWith(PO_DOCUMENTS_BUCKET)
    expect(mockUpload).toHaveBeenCalledWith(PATH, DOCUMENT, { contentType: 'application/pdf', upsert: true })
  })

  it('builds a session-less client from the secret key', async () => {
    mockUpload.mockResolvedValueOnce({ data: { path: PATH }, error: null })

    await uploadPoDocument(PATH, DOCUMENT, 'application/pdf')

    expect(mockCreateClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_secret_test_placeholder',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    )
  })

  it('throws PoDocumentStorageError naming the path, never the content', async () => {
    mockUpload.mockResolvedValueOnce({ data: null, error: new Error('mime type not allowed') })

    const thrown = await uploadPoDocument(PATH, DOCUMENT, 'application/pdf').catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(PoDocumentStorageError)
    const error = thrown as PoDocumentStorageError
    expect(error.operation).toBe('upload')
    expect(error.path).toBe(PATH)
    expect(error.message).toContain(PATH)
    expect(error.message).not.toContain(DOCUMENT.toString())
  })

  it('throws StorageConfigError naming the variable when the secret key is missing', async () => {
    vi.stubEnv(KEY_VARIABLE, '')

    const thrown = await uploadPoDocument(PATH, DOCUMENT, 'application/pdf').catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(StorageConfigError)
    expect((thrown as StorageConfigError).variable).toBe(KEY_VARIABLE)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('throws StorageConfigError when the project URL is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')

    await expect(uploadPoDocument(PATH, DOCUMENT, 'application/pdf')).rejects.toThrow(StorageConfigError)
  })
})

describe('downloadPoDocument', () => {
  it('returns the object bytes as a Buffer', async () => {
    mockDownload.mockResolvedValueOnce({ data: new Blob([new Uint8Array(DOCUMENT)]), error: null })

    const bytes = await downloadPoDocument(PATH)

    expect(mockFrom).toHaveBeenCalledWith(PO_DOCUMENTS_BUCKET)
    expect(mockDownload).toHaveBeenCalledWith(PATH)
    expect(Buffer.compare(bytes, DOCUMENT)).toBe(0)
  })

  it('throws PoDocumentStorageError naming the path when the object is missing', async () => {
    mockDownload.mockResolvedValueOnce({ data: null, error: new Error('Object not found') })

    const thrown = await downloadPoDocument(PATH).catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(PoDocumentStorageError)
    expect((thrown as PoDocumentStorageError).operation).toBe('download')
    expect((thrown as PoDocumentStorageError).message).toContain(PATH)
  })

  it('throws StorageConfigError when the secret key is missing', async () => {
    vi.stubEnv(KEY_VARIABLE, '')

    await expect(downloadPoDocument(PATH)).rejects.toThrow(StorageConfigError)
  })
})
