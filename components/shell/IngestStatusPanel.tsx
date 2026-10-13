'use client'

import { AlertTriangle, Clock, Loader2, Mail, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IngestStatus } from '@/lib/actions/ingest'
import { formatLastChecked, isCheckStale } from '@/lib/ingest/ingest-status-display'

interface IngestStatusPanelProps {
  status: IngestStatus | null
  hasLoadError: boolean
  isChecking: boolean
  onRetry: () => void
  onCheckMail: () => void
  /** The current time; a prop so tests can pin "Today" and staleness. */
  now?: Date
}

/** The undecided total and its split: the number the menu badge shows. */
function PendingSummary({ status }: { status: IngestStatus }) {
  const total = status.toReview + status.beingRead
  if (total === 0) return <p className="text-sm text-secondary">Nothing pending</p>
  return (
    <div>
      <p className="text-2xl font-bold text-foreground">{total} pending</p>
      <p className="text-xs text-secondary">
        {status.toReview} to review · {status.beingRead} being read
      </p>
    </div>
  )
}

/** "Last checked …", amber when it is too old to trust or has never run. */
function LastChecked({ lastRunAt, now }: { lastRunAt: string | null; now: Date }) {
  const isStale = isCheckStale(lastRunAt, now)
  const label = formatLastChecked(lastRunAt, now)
  return (
    <p
      data-stale={isStale}
      className={`flex items-center gap-1.5 text-xs rounded-md ${isStale ? 'bg-amber-100 text-amber-800 px-2 py-1' : 'text-secondary'}`}
    >
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      {lastRunAt ? `Last checked ${label}` : label}
    </p>
  )
}

/** Emails that keep failing to import: loud, because only a human can act on what follows. */
function FailingAlert({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs rounded-md bg-orange-100 text-orange-800 px-2 py-1.5">
      <AlertTriangle className="size-3.5 shrink-0 mt-px" aria-hidden="true" />
      {count === 1 ? "1 email can't be imported." : `${count} emails can't be imported.`} They retry automatically,
      then appear for review.
    </p>
  )
}

function CheckMailButton({ isChecking, onCheckMail }: { isChecking: boolean; onCheckMail: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onCheckMail} disabled={isChecking} className="w-full min-h-[44px]">
      {isChecking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Mail aria-hidden="true" />}
      {isChecking ? 'Checking mail…' : 'Check mail now'}
    </Button>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2">
      <p className="text-sm text-destructive">Couldn&apos;t load the review queue.</p>
      <Button type="button" variant="outline" onClick={onRetry} className="w-full min-h-[44px]">
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

/**
 * The review-queue section at the top of the nav drawer (Task 105): every
 * undecided PO, when mail was last checked, emails failing to import, and
 * "Check mail now". Task 106 adds the "Review" action here.
 *
 * Presentational: state and actions come from `useIngestStatus` via `AppShell`.
 */
export default function IngestStatusPanel({
  status,
  hasLoadError,
  isChecking,
  onRetry,
  onCheckMail,
  now = new Date(),
}: IngestStatusPanelProps) {
  return (
    <section aria-label="Review queue" className="px-4 py-4 border-b border-border space-y-3 shrink-0">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">Review queue</h2>
      {hasLoadError ? (
        <LoadError onRetry={onRetry} />
      ) : status ? (
        <>
          <PendingSummary status={status} />
          <LastChecked lastRunAt={status.lastRunAt} now={now} />
          <FailingAlert count={status.failingCount} />
        </>
      ) : (
        <p className="text-sm text-secondary">Loading…</p>
      )}
      <CheckMailButton isChecking={isChecking} onCheckMail={onCheckMail} />
    </section>
  )
}
