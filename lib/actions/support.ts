'use server'

import { count, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { supportTickets, supportAttachments } from '@/db/schema'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/validators/uuid'
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES } from './support.constants'

// User-facing fallback for any server-side failure that isn't a validation,
// auth, or business-rule rejection. Detailed cause is logged server-side via
// console.error — never surfaced to the client (SEC-05, EH-04).
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'

const TITLE_MAX = 200
// 5000 chars — ample for a detailed bug report while guarding textarea/DB bloat.
const DESCRIPTION_MAX = 5000

// Private bucket created in Task 3 (db/migrations/0003_storage_buckets.sql).
// All downloads go through server-generated signed URLs (CONSTRAINT-06).
const BUCKET_NAME = 'support-attachments'

// Per-file size cap — 5 MB. Plan Task 26: "max 5MB/file".
const MAX_FILE_BYTES = 5 * 1024 * 1024
// Per-ticket attachment count cap. Plan Task 26: "max 3 files".
const MAX_ATTACHMENTS_PER_TICKET = 3
// Signed URL expiry for attachment downloads. Plan Task 27: "1-hour expiry".
// CONSTRAINT-06: every download goes through a server-generated signed URL;
// raw storage paths are never returned to the client.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60
// MIME allow-list. Browser-reported `file.type` can be spoofed, so this is
// defense-in-depth — the bucket is private, files are never executed, and
// downloads go through signed URLs (CONSTRAINT-06). SEC-02 boundary check.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const
// Truncate filenames before storing — Postgres text is unbounded but storage
// paths + DB bloat grow unbounded with unsanitised filenames.
const FILENAME_MAX = 200

const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(TITLE_MAX),
  category: z.enum(SUPPORT_CATEGORIES),
  priority: z.enum(SUPPORT_PRIORITIES),
  description: z.string().trim().min(1, 'Description is required.').max(DESCRIPTION_MAX),
})

export type CreateTicketInput = z.input<typeof createTicketSchema>

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.'
}

async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { error: 'You are not signed in.' }
  return null
}

/**
 * Creates a new support ticket with status='open'. Attachments are uploaded
 * separately via uploadTicketAttachment(ticketId, file) after this resolves —
 * per the plan's partial-failure contract, the ticket is intentionally saved
 * before attachments so a failed upload doesn't discard the user's write-up.
 */
export async function createTicket(
  input: CreateTicketInput,
): Promise<{ id: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  const parsed = createTicketSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const [row] = await db
      .insert(supportTickets)
      .values({
        title: parsed.data.title,
        category: parsed.data.category,
        priority: parsed.data.priority,
        description: parsed.data.description,
        status: 'open',
      })
      .returning({ id: supportTickets.id })
    revalidatePath('/support')
    return { id: row.id }
  } catch (cause) {
    console.error('createTicket: insert failed', { cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

// Strip path separators, `..` traversal segments, and control characters
// (NUL + C0 range) from a client-supplied filename. Prefixing with a UUID
// in the storage path also prevents collisions when two files share a
// name — the original name is preserved in `support_attachments.file_name`
// for display.
function sanitizeFilename(name: string): string {
  const base = name
    // eslint-disable-next-line no-control-regex -- intentional: strip NUL/C0 from hostile filenames (LOW-03 fix).
    .replace(/[\x00-\x1F]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '_')
    .slice(0, FILENAME_MAX)
  return base.length > 0 ? base : 'attachment'
}

function validateFile(file: File): { error: string } | null {
  if (file.size > MAX_FILE_BYTES) {
    return { error: 'File too large. Maximum 5MB per file.' }
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return { error: 'Only PNG, JPG, and PDF files are accepted.' }
  }
  return null
}

async function assertAttachmentQuotaAvailable(
  ticketId: string,
): Promise<{ error: string } | null> {
  const [row] = await db
    .select({ n: count() })
    .from(supportAttachments)
    .where(eq(supportAttachments.ticket_id, ticketId))
  if ((row?.n ?? 0) >= MAX_ATTACHMENTS_PER_TICKET) {
    return { error: 'Maximum 3 attachments per ticket.' }
  }
  return null
}

// Best-effort cleanup of an orphaned storage object after a post-upload
// failure (LOW-01 fix). Failures during cleanup are logged but never mask
// the original error — the user sees the original rejection regardless.
async function removeOrphanedUpload(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<void> {
  try {
    await supabase.storage.from(BUCKET_NAME).remove([storagePath])
  } catch (cause) {
    console.error('uploadTicketAttachment: orphan cleanup failed', { storagePath, cause })
  }
}

// Transactional quota re-check + insert under a per-ticket advisory lock
// (LOW-02 fix). Without the lock, two concurrent uploads for the same
// ticket could both pass the pre-upload count check (both see `n=2`), both
// upload, and both insert — leaving 4 attachments on a ticket capped at 3.
// The advisory lock serialises the count+insert so the second call waits,
// re-reads the now-3 count, and returns `over_quota`.
async function insertAttachmentWithQuotaLock(
  ticketId: string,
  storagePath: string,
  fileName: string,
): Promise<{ status: 'ok' } | { status: 'over_quota' }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ticketId}))`)
    const [row] = await tx
      .select({ n: count() })
      .from(supportAttachments)
      .where(eq(supportAttachments.ticket_id, ticketId))
    if ((row?.n ?? 0) >= MAX_ATTACHMENTS_PER_TICKET) {
      return { status: 'over_quota' } as const
    }
    await tx.insert(supportAttachments).values({
      ticket_id: ticketId,
      file_url: storagePath,
      file_name: fileName,
    })
    return { status: 'ok' } as const
  })
}

/**
 * Uploads a single attachment to the private `support-attachments` bucket
 * and inserts a row in `support_attachments`. Returns the storage path
 * (never a URL — downloads go through server-generated signed URLs per
 * CONSTRAINT-06). The client calls this serially per file so each quota
 * check reflects the state produced by the previous upload.
 *
 * File type/size/count are re-validated server-side — client validation is
 * UX only (SEC-02). A pre-upload count check fast-fails when the ticket is
 * already at its cap (saves the upload round-trip); the authoritative
 * re-check + insert runs under an advisory lock inside a transaction so
 * concurrent uploads cannot race past the cap. On any post-upload
 * failure the orphaned storage object is removed so no ghost files
 * accumulate against the free-tier quota (LOW-01).
 */
export async function uploadTicketAttachment(
  ticketId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(ticketId)) return { error: 'Invalid ticket id.' }

  const fileError = validateFile(file)
  if (fileError) return fileError

  const fastFailError = await assertAttachmentQuotaAvailable(ticketId)
  if (fastFailError) return fastFailError

  const sanitizedName = sanitizeFilename(file.name)
  const storagePath = `${ticketId}/${crypto.randomUUID()}_${sanitizedName}`
  const supabase = createClient()

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    // Upload failed before any DB state change — nothing to clean up.
    console.error('uploadTicketAttachment: storage upload failed', { ticketId, cause: uploadError })
    return { error: GENERIC_FAILURE_MESSAGE }
  }

  try {
    const outcome = await insertAttachmentWithQuotaLock(ticketId, storagePath, sanitizedName)
    if (outcome.status === 'over_quota') {
      await removeOrphanedUpload(supabase, storagePath)
      return { error: 'Maximum 3 attachments per ticket.' }
    }
    revalidatePath('/support')
    return { path: storagePath }
  } catch (cause) {
    await removeOrphanedUpload(supabase, storagePath)
    console.error('uploadTicketAttachment: insert failed', { ticketId, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Generates a short-lived signed URL for a support attachment download.
 * The client passes an attachment row id — the action looks the row up
 * to obtain the storage path, so an attacker cannot craft arbitrary paths
 * to other bucket contents. Returns `{ url }` on success; the link works
 * for SIGNED_URL_EXPIRY_SECONDS and requires nothing but possession of
 * the URL (Supabase's signed-URL design). CONSTRAINT-06 enforced.
 */
export async function getSupportAttachmentSignedUrl(
  attachmentId: string,
): Promise<{ url: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(attachmentId)) return { error: 'Invalid attachment id.' }

  let storagePath: string
  try {
    const [row] = await db
      .select({ file_url: supportAttachments.file_url })
      .from(supportAttachments)
      .where(eq(supportAttachments.id, attachmentId))
      .limit(1)
    if (!row) return { error: 'Attachment not found.' }
    storagePath = row.file_url
  } catch (cause) {
    console.error('getSupportAttachmentSignedUrl: lookup failed', { attachmentId, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }

  const supabase = createClient()
  const { data, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)

  if (signError || !data?.signedUrl) {
    console.error('getSupportAttachmentSignedUrl: sign failed', {
      attachmentId,
      storagePath,
      cause: signError,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }

  return { url: data.signedUrl }
}
