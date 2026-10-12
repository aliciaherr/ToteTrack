/**
 * Errors for `lib/storage/po-documents.ts` (Task 103, CONSTRAINT-38).
 *
 * Messages name the variable, operation and object key only — never document
 * bytes or text (SEC-05). Keys are content-addressed, so a key is a hash and
 * reveals nothing about the document.
 */

/**
 * A variable the storage module needs is unset or empty. Thrown before any
 * client is built, so a misconfigured deploy fails on its first call rather
 * than with an opaque 401 from Storage. Names the variable, never its value.
 */
export class StorageConfigError extends Error {
  readonly variable: string

  constructor(variable: string) {
    super(`PO document storage is not configured: ${variable} is not set`)
    this.name = 'StorageConfigError'
    this.variable = variable
  }
}

/** Which storage call failed. */
export type PoDocumentOperation = 'upload' | 'download'

/**
 * Storage rejected an upload or download of one PO document. Carries the
 * bucket and key so the object is identifiable; the Storage client's own
 * error is kept as `cause`.
 */
export class PoDocumentStorageError extends Error {
  readonly operation: PoDocumentOperation
  readonly bucket: string
  readonly path: string

  constructor(
    operation: PoDocumentOperation,
    bucket: string,
    path: string,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(`PO document ${operation} for ${bucket}/${path} failed: ${reason}`, options)
    this.name = 'PoDocumentStorageError'
    this.operation = operation
    this.bucket = bucket
    this.path = path
  }
}
