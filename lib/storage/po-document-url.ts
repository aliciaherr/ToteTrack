import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'
import { createClient } from '@/lib/supabase/server'
import { isInboundDocumentPath } from './po-document-path'
import { SIGNED_URL_EXPIRY_SECONDS } from './po-document-url.constants'

/**
 * Signs a stored PO document for a signed-in user (Tasks 106 and 121). Uses
 * the **session** client: the `po-documents` bucket lets any signed-in user
 * read it (migration 0003), so no secret key is involved (CONSTRAINT-38).
 * Not `'use server'`: callers are server actions that check the session.
 * The path gate lives here, so every caller gets it (SEC-02): only a key under
 * `inbound/` is ever handed to Storage.
 */

// Re-exported for existing server callers; client code imports the constants file.
export { SIGNED_URL_EXPIRY_SECONDS }

/** `storageError` when the path is not an `inbound/` key: refused before Storage is called. */
export const NOT_INBOUND_PATH = 'not_inbound_path'

/**
 * The signed URL, or why not, for the caller to log by id: the Storage
 * error's name (never its message), or {@link NOT_INBOUND_PATH}. Never the path.
 */
export type SignedDocumentResult = { url: string } | { storageError: string | null }

/**
 * A 1-hour signed URL for one object in the `po-documents` bucket.
 *
 * @param documentPath A stored key, any value: refused unless `isInboundDocumentPath` accepts it.
 * @returns `{ url }`, `{ storageError: NOT_INBOUND_PATH }` for a refused
 *   path, or `{ storageError }` when Storage refuses or returns no URL.
 */
export async function signPoDocument(documentPath: string): Promise<SignedDocumentResult> {
  if (!isInboundDocumentPath(documentPath)) return { storageError: NOT_INBOUND_PATH }
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(PO_DOCUMENTS_BUCKET)
    .createSignedUrl(documentPath, SIGNED_URL_EXPIRY_SECONDS)
  if (error || !data?.signedUrl) return { storageError: error?.name ?? null }
  return { url: data.signedUrl }
}
