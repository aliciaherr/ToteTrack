import { describe, it, expect } from 'vitest'
import { DatabaseError } from '@/lib/errors'
import {
  ExtractionConfigError,
  ExtractionResponseError,
  OpenRouterHttpError,
  OpenRouterTimeoutError,
  PdfPageTooLargeError,
  PdfRenderTimeoutError,
  PdfTooManyPagesError,
  TextInputTooLongError,
} from '@/lib/extraction/errors'
import { PoDocumentStorageError, StorageConfigError } from '@/lib/storage/errors'
import {
  ExtractionAttemptsExhaustedError,
  MissingExtractionInputError,
  isBatchStoppingError,
  isPermanentExtractionError,
} from '../worker-errors'

describe('isPermanentExtractionError', () => {
  it.each([
    new TextInputTooLongError(100_000, 50_000),
    new PdfTooManyPagesError(30, 10),
    new PdfPageTooLargeError(1, 1e9, 1e8),
    new ExtractionResponseError('m', 'bad'),
    new MissingExtractionInputError('id', 'pdf', 'document_path is NULL'),
    new ExtractionAttemptsExhaustedError('id', 3),
  ])('treats %s as permanent', (error) => {
    expect(isPermanentExtractionError(error)).toBe(true)
  })

  it.each([
    new OpenRouterHttpError(502, 'm', 'bad gateway'),
    new OpenRouterTimeoutError('m', 1000),
    new PdfRenderTimeoutError(1000),
    new PoDocumentStorageError('download', 'po-documents', 'inbound/x.pdf', 'timeout'),
    new DatabaseError('op', 'down'),
    'not an error',
  ])('treats %s as transient', (error) => {
    expect(isPermanentExtractionError(error)).toBe(false)
  })
})

describe('isBatchStoppingError', () => {
  it('stops on a missing OpenRouter key or Storage credential', () => {
    expect(isBatchStoppingError(new ExtractionConfigError('OPENROUTER_API_KEY', 'missing'))).toBe(true)
    expect(isBatchStoppingError(new StorageConfigError('NEXT_PUBLIC_SUPABASE_URL'))).toBe(true)
  })

  it('does not stop on a row-level failure', () => {
    expect(isBatchStoppingError(new OpenRouterTimeoutError('m', 1000))).toBe(false)
    expect(isBatchStoppingError(new PdfTooManyPagesError(30, 10))).toBe(false)
  })
})
