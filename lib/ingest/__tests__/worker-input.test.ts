import { describe, it, expect, vi } from 'vitest'
import { PoDocumentStorageError } from '@/lib/storage/errors'
import { MissingExtractionInputError } from '../worker-errors'
import { loadExtractionInput } from '../worker-input'
import { claimed } from './worker-fixtures'

const BYTES = Buffer.from('document-bytes')

describe('loadExtractionInput', () => {
  it('downloads a PDF by its stored key', async () => {
    const download = vi.fn().mockResolvedValue(BYTES)
    const row = claimed()

    expect(await loadExtractionInput(row, download)).toEqual({ kind: 'pdf', bytes: BYTES })
    expect(download).toHaveBeenCalledWith(row.document_path)
  })

  it.each([
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
  ])('reads the image type back from a %s key', async (extension, mimeType) => {
    const row = claimed({ source_kind: 'image', document_path: `inbound/${'b'.repeat(64)}${extension}` })
    expect(await loadExtractionInput(row, vi.fn().mockResolvedValue(BYTES))).toEqual({ kind: 'image', mimeType, bytes: BYTES })
  })

  it('reads an email body from the row, without downloading', async () => {
    const download = vi.fn()
    const row = claimed({ source_kind: 'email_body', document_path: null, body_text: 'po text' })

    expect(await loadExtractionInput(row, download)).toEqual({ kind: 'text', text: 'po text' })
    expect(download).not.toHaveBeenCalled()
  })

  it.each([
    ['an email body with no text', claimed({ source_kind: 'email_body', document_path: null, body_text: null })],
    ['a PDF with no key', claimed({ document_path: null })],
    ['an image key with no image extension', claimed({ source_kind: 'image', document_path: 'inbound/x.pdf' })],
  ])('refuses %s as missing input', async (_label, row) => {
    await expect(loadExtractionInput(row, vi.fn())).rejects.toBeInstanceOf(MissingExtractionInputError)
  })

  it('passes a storage failure through unchanged', async () => {
    const failure = new PoDocumentStorageError('download', 'po-documents', 'inbound/x.pdf', 'not found')
    await expect(loadExtractionInput(claimed(), vi.fn().mockRejectedValue(failure))).rejects.toBe(failure)
  })
})
