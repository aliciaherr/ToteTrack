import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'
import { createClient } from '@/lib/supabase/server'

/**
 * Signs a stored PO document for a signed-in user (Tasks 106 and 121). Uses
 * the **session** client: the `po-documents` bucket lets any signed-in user
 * read it (migration 0003), so no secret key is involved (CONSTRAINT-38).
 * Not `'use server'`: callers are server actions that check the session and
 * the path first.
 */

/** How long a signed document URL works: 1 hour, as for support attachments. */
export const SIGNED_URL_EXPIRY_SECONDS = 60 * 60

/** The signed URL, or the Storage error's name (never its message) for the caller to log. */
export type SignedDocumentResult = { url: string } | { storageError: string | null }

/**
 * A 1-hour signed URL for one object in the `po-documents` bucket.
 *
 * @param documentPath A key the caller has already validated.
 * @returns `{ url }`, or `{ storageError }` when Storage refuses or returns no URL.
 */
export async function signPoDocument(documentPath: string): Promise<SignedDocumentResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(PO_DOCUMENTS_BUCKET)
    .createSignedUrl(documentPath, SIGNED_URL_EXPIRY_SECONDS)
  if (error || !data?.signedUrl) return { storageError: error?.name ?? null }
  return { url: data.signedUrl }
}
