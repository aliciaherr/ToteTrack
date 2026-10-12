import type { ClaimedPo } from '@/db/queries/extraction-queue'
import type { ExtractionInput } from '@/lib/extraction/types'
import { PO_DOCUMENT_EXTENSIONS, type AcceptedMimeType } from './ingest.constants'
import { MissingExtractionInputError } from './worker-errors'

type ImageMimeType = Extract<AcceptedMimeType, `image/${string}`>

/**
 * The image type for a stored key, read back from the extension
 * `documentPathFor` wrote. `inbound_pos` keeps no MIME column, and the key's
 * extension comes from the accepted type, never the sender's filename.
 */
function imageMimeTypeFor(path: string): ImageMimeType | null {
  for (const [mimeType, extension] of Object.entries(PO_DOCUMENT_EXTENSIONS)) {
    if (mimeType.startsWith('image/') && path.endsWith(extension)) return mimeType as ImageMimeType
  }
  return null
}

function requireDocumentPath(row: ClaimedPo): string {
  if (!row.document_path) throw new MissingExtractionInputError(row.id, row.source_kind, 'document_path is NULL')
  return row.document_path
}

/**
 * Loads what `extractPo` reads for one claimed row: the stored file for a
 * `pdf` or `image` row, the stored body for an `email_body` row (FB-42).
 *
 * @param row The claimed row.
 * @param download Reads one object from the PO documents bucket.
 * @returns The extraction input, by kind.
 * @throws {MissingExtractionInputError} when the row has nothing to read.
 * @throws Whatever `download` throws (storage errors are transient).
 */
export async function loadExtractionInput(
  row: ClaimedPo,
  download: (path: string) => Promise<Buffer>,
): Promise<ExtractionInput> {
  if (row.source_kind === 'email_body') {
    if (row.body_text === null) throw new MissingExtractionInputError(row.id, row.source_kind, 'body_text is NULL')
    return { kind: 'text', text: row.body_text }
  }
  const path = requireDocumentPath(row)
  if (row.source_kind === 'pdf') return { kind: 'pdf', bytes: await download(path) }

  const mimeType = imageMimeTypeFor(path)
  if (!mimeType) throw new MissingExtractionInputError(row.id, row.source_kind, 'the key names no accepted image type')
  return { kind: 'image', mimeType, bytes: await download(path) }
}
