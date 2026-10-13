'use client'

import { format, parseISO } from 'date-fns'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { RefusalDescription, ReviewEmail } from '@/lib/review/review-source'

interface RefusalCardProps {
  refusal: RefusalDescription
  email: ReviewEmail
}

/** The full date and time an email arrived; the raw value when it does not parse. */
function formatReceived(receivedAt: string | null): string | null {
  if (!receivedAt) return null
  const parsed = parseISO(receivedAt)
  return Number.isNaN(parsed.getTime()) ? receivedAt : format(parsed, 'EEE, MMM d yyyy, h:mm a')
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-secondary">{label}</dt>
      <dd className="text-foreground break-words">{value}</dd>
    </div>
  )
}

/**
 * Why an email could not be imported, and what to do about it (Task 106).
 * Every sender-controlled value renders as plain text, the file type included
 * (LOW-NEW-2). The Gmail link appears only when the email had a Message-ID.
 */
export default function RefusalCard({ refusal, email }: RefusalCardProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-foreground">{refusal.title}</h3>
          <p className="text-sm text-secondary">{refusal.nextStep}</p>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <Detail label="From" value={email.from} />
        <Detail label="Subject" value={email.subject} />
        <Detail label="Received" value={formatReceived(email.receivedAt)} />
        <Detail label="File type" value={refusal.fileType} />
      </dl>
      {email.gmailUrl && (
        <a
          href={email.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-border text-sm font-medium text-primary hover:bg-muted"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open in Gmail
        </a>
      )}
    </div>
  )
}
