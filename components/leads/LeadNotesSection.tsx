'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { addLeadNote } from '@/lib/actions/leads'
import { NOTE_CONTENT_MAX } from '@/lib/actions/leads.constants'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import type { LeadNote } from '@/db/queries/leads'

interface LeadNotesSectionProps {
  leadId: string
  notes: LeadNote[]
  onSaved: () => void
}

/** What `runAddNote` writes through, so it can live outside the component. */
interface AddNoteDeps {
  setContent: (value: string) => void
  setServerError: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
  onSaved: () => void
}

// Hoisted out of the component: nested function bodies count toward the
// enclosing component's length, and the try/catch below took it over the cap.
async function runAddNote(
  leadId: string,
  content: string,
  { setContent, setServerError, setIsSubmitting, onSaved }: AddNoteDeps,
): Promise<void> {
  setServerError(null)
  setIsSubmitting(true)
  try {
    const result = await addLeadNote(leadId, content)
    if ('error' in result) {
      setServerError(result.error)
      return
    }
    setContent('')
    onSaved()
  } catch (cause) {
    // `handleSave` is called from an onClick that discards the returned
    // promise, so a transport-level rejection (offline, stale action id after
    // a deploy) would otherwise vanish: nothing logged, no inline error, and
    // Save Note stuck disabled with no recovery but a reload (EH-01). The
    // textarea is deliberately left alone — only the success branch clears it,
    // so the note the salesperson typed survives a failed save and can be
    // retried without retyping.
    console.error('LeadNotesSection: addLeadNote failed in transit', {
      leadId,
      cause,
    })
    setServerError(GENERIC_FAILURE_MESSAGE)
  } finally {
    setIsSubmitting(false)
  }
}

function formatNoteTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return `[${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}]`
}

/**
 * Append-only notes panel. Renders the lead's note log in chronological order
 * and exposes a textarea + save button for adding new notes. Whitespace-only
 * submissions are blocked client-side with the same message the server returns
 * (server-side Zod `.trim().min(1)` is the authoritative check). Notes are not
 * editable after save — there are no edit/delete affordances by design.
 */
export default function LeadNotesSection({ leadId, notes, onSaved }: LeadNotesSectionProps) {
  const [content, setContent] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSave() {
    if (!content.trim()) {
      setClientError('Note cannot be empty.')
      return
    }
    setClientError(null)
    await runAddNote(leadId, content, { setContent, setServerError, setIsSubmitting, onSaved })
  }

  const displayError = clientError ?? serverError

  return (
    <section aria-label="Notes" className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="text-sm text-foreground space-y-0.5">
              <span className="text-xs text-muted-foreground font-mono">
                {formatNoteTimestamp(note.created_at)}
              </span>
              <p className="whitespace-pre-wrap">{note.content}</p>
            </div>
          ))
        )}
      </div>
      <div className="space-y-2 pt-2 border-t border-border">
        {displayError && (
          <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
            {displayError}
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            if (clientError) setClientError(null)
          }}
          placeholder="Add a note..."
          maxLength={NOTE_CONTENT_MAX}
          rows={3}
          aria-label="New note content"
          className="w-full text-sm bg-muted rounded-md border border-border p-2 focus:outline-none focus:ring-2 focus:ring-ring resize-none placeholder:text-muted-foreground"
        />
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting}
          className="w-full min-h-[44px]"
        >
          {isSubmitting ? 'Saving…' : 'Save Note'}
        </Button>
      </div>
    </section>
  )
}
