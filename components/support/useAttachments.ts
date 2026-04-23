'use client'

import { useState, type ChangeEvent } from 'react'

// Per-file size cap — 5 MB. Keep in sync with `lib/actions/support.ts`
// which re-validates server-side (SEC-02).
const MAX_FILE_BYTES = 5 * 1024 * 1024
// Per-ticket attachment count cap — matches the server-side quota check.
const MAX_FILES = 3
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'application/pdf'] as const

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return 'File too large. Maximum 5MB per file.'
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return 'Only PNG, JPG, and PDF files are accepted.'
  }
  return null
}

interface UseAttachments {
  files: File[]
  error: string | null
  addFiles: (event: ChangeEvent<HTMLInputElement>) => void
  removeFile: (index: number) => void
  reset: () => void
}

/**
 * Owns the attachment list state for the New Ticket form: the selected
 * `files` array, the `error` string (count cap / type / size), and the
 * `addFiles` / `removeFile` / `reset` handlers. Client-side validation
 * matches the server's messages exactly so the UX is consistent whether
 * the reject fires in-browser or server-side.
 *
 * Extracted from `NewTicketForm.tsx` so the component's procedural body
 * stays within CONSTRAINT-14's 50-line non-JSX cap.
 */
export function useAttachments(): UseAttachments {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files
    if (!picked || picked.length === 0) return
    setError(null)
    const next = [...files]
    let rejectedForCount = false
    for (const file of Array.from(picked)) {
      if (next.length >= MAX_FILES) {
        rejectedForCount = true
        break
      }
      const validationError = validateFile(file)
      if (validationError) {
        setError(validationError)
        continue
      }
      next.push(file)
    }
    if (rejectedForCount) setError('Maximum 3 attachments per ticket.')
    setFiles(next)
  }

  function removeFile(index: number) {
    setFiles(files.filter((_, i) => i !== index))
    setError(null)
  }

  function reset() {
    setFiles([])
    setError(null)
  }

  return { files, error, addFiles, removeFile, reset }
}
