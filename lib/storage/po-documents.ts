import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PO_DOCUMENTS_BUCKET } from '@/lib/ingest/ingest.constants'
import { PoDocumentStorageError, StorageConfigError, type PoDocumentOperation } from './errors'

/**
 * Session-less access to the `po-documents` bucket (Task 103, FB-42).
 *
 * The cron and the self-chained extraction worker have no user session, so
 * the cookie-based client in `lib/supabase/server.ts` cannot reach Storage
 * for them. This module builds a client from the Supabase **secret key** and
 * exposes exactly two operations, both pinned to `PO_DOCUMENTS_BUCKET`.
 *
 * **CONSTRAINT-38: this is the only file that may read `SUPABASE_SECRET_KEY`.**
 * The key bypasses RLS, so the client never leaves this module: no other
 * bucket, table or Auth admin call is reachable through it. Never import this
 * from a component or a `'use server'` module. A grep test
 * (`__tests__/secret-key-confinement.test.ts`) fails the suite if any other
 * source file names the variable.
 */

const SECRET_KEY_VARIABLE = 'SUPABASE_SECRET_KEY'
const URL_VARIABLE = 'NEXT_PUBLIC_SUPABASE_URL'

/** The variable's value, or a loud `StorageConfigError` naming it. */
function requiredEnv(variable: string): string {
  const value = process.env[variable]
  if (!value) throw new StorageConfigError(variable)
  return value
}

/**
 * A fresh client per call: the worker makes a handful of calls per batch, so
 * caching buys nothing and a cached client would outlive a rotated key. No
 * session is persisted or refreshed — the key is the only credential.
 */
function storageBucket() {
  const client: SupabaseClient = createClient(requiredEnv(URL_VARIABLE), requiredEnv(SECRET_KEY_VARIABLE), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client.storage.from(PO_DOCUMENTS_BUCKET)
}

function failure(operation: PoDocumentOperation, path: string, cause: unknown): PoDocumentStorageError {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new PoDocumentStorageError(operation, PO_DOCUMENTS_BUCKET, path, reason, { cause })
}

/**
 * Writes one PO document to `PO_DOCUMENTS_BUCKET`, **overwriting** any object
 * already at `path`. Keys are content-addressed, so a re-run after a crash
 * writes the same key; `upsert: true` makes that succeed instead of failing
 * with "already exists" and pinning the watermark (MEDIUM-06).
 *
 * @param path The object key inside the bucket, from `documentPathFor`.
 * @param bytes The document's bytes.
 * @param contentType The accepted MIME type, checked by the bucket's allow-list.
 * @throws {StorageConfigError} when the URL or secret key is unset.
 * @throws {PoDocumentStorageError} when Storage rejects the upload.
 */
export async function uploadPoDocument(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const bucket = storageBucket()
  const { error } = await bucket.upload(path, bytes, { contentType, upsert: true })
  if (error) throw failure('upload', path, error)
}

/**
 * Reads one PO document from `PO_DOCUMENTS_BUCKET`.
 *
 * @param path The object key, as stored in `inbound_pos.document_path`.
 * @returns The document's bytes.
 * @throws {StorageConfigError} when the URL or secret key is unset.
 * @throws {PoDocumentStorageError} when the object is missing or Storage fails.
 */
export async function downloadPoDocument(path: string): Promise<Buffer> {
  const bucket = storageBucket()
  const { data, error } = await bucket.download(path)
  if (error) throw failure('download', path, error)
  return Buffer.from(await data.arrayBuffer())
}
