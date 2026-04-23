'use client'

import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { getSupportAttachmentSignedUrl } from '@/lib/actions/support'
import type { TicketAttachment } from '@/db/queries/support'

// Opens a blank tab synchronously inside the click handler so the
// subsequent navigation is treated as a user-initiated action (not a
// popup), then swaps its location to the fresh signed URL once the
// server action resolves. Raw storage paths never leave the server —
// CONSTRAINT-06.
function AttachmentLink({ attachment }: { attachment: TicketAttachment }) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setIsPending(true)
    const newTab = window.open('about:blank', '_blank')
    try {
      const result = await getSupportAttachmentSignedUrl(attachment.id)
      if ('error' in result) {
        newTab?.close()
        setError(result.error)
        return
      }
      if (newTab) {
        newTab.location.href = result.url
      } else {
        setError('Could not open the attachment. Allow popups for this site and try again.')
      }
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-60 min-h-[44px] text-left"
      >
        <Paperclip className="h-4 w-4 shrink-0" />
        <span className="truncate">{attachment.file_name}</span>
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Renders the attachment block for `TicketDetail`. Shows a neutral
 * "No attachments." placeholder when the list is empty; otherwise emits
 * one click-to-download link per row. Each link fetches a fresh 1-hour
 * signed URL via `getSupportAttachmentSignedUrl` and opens it in a new
 * tab — callers never touch the raw storage path.
 */
export default function TicketAttachments({
  attachments,
}: {
  attachments: TicketAttachment[]
}) {
  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">No attachments.</p>
  }
  return (
    <ul role="list" className="space-y-1">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentLink attachment={attachment} />
        </li>
      ))}
    </ul>
  )
}
