'use client'

import Link from 'next/link'
import type { TicketDetail as TicketDetailType } from '@/db/queries/support'
import TicketAttachments from './TicketAttachments'
import {
  categoryLabel,
  priorityBadgeClasses,
  priorityLabel,
  statusBadgeClasses,
  statusLabel,
} from './ticketBadgeStyles'

interface TicketDetailProps {
  detail: TicketDetailType | null
  backHref: string
}

export function TicketDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select an issue to view details.
    </div>
  )
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-b-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right">{children}</span>
    </div>
  )
}

function StatusPill({ status }: { status: TicketDetailType['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors duration-200 ease-in-out ${statusBadgeClasses(status)}`}
    >
      {statusLabel(status)}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: TicketDetailType['priority'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide transition-colors duration-200 ease-in-out ${priorityBadgeClasses(priority)}`}
    >
      {priorityLabel(priority)}
    </span>
  )
}

function DetailHeader({ backHref }: { backHref: string }) {
  return (
    <div className="flex items-center justify-between">
      <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to issues
      </Link>
    </div>
  )
}

function NotFoundState({ backHref }: { backHref: string }) {
  return (
    <div className="p-6 space-y-4">
      <DetailHeader backHref={backHref} />
      <p className="py-12 text-center text-sm text-muted-foreground">
        Ticket not found. It may have been deleted or the link is stale.
      </p>
    </div>
  )
}

function TicketHeader({ detail }: { detail: TicketDetailType }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground break-words">
          {detail.title}
        </h2>
        <p className="text-xs text-muted-foreground">
          Opened {formatTimestamp(detail.created_at)}
        </p>
      </div>
      <StatusPill status={detail.status} />
    </div>
  )
}

/**
 * Read-only support ticket detail panel. Renders title, category, priority,
 * description, status, developer_notes (with a neutral placeholder when
 * unset), and the attachment list via `TicketAttachments`. Renders
 * `NotFoundState` when `detail` is null (the server component could not
 * resolve `?id=`).
 */
export default function TicketDetail({ detail, backHref }: TicketDetailProps) {
  if (!detail) return <NotFoundState backHref={backHref} />

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <DetailHeader backHref={backHref} />
      <TicketHeader detail={detail} />
      <section aria-label="Issue metadata" className="rounded-lg border border-border bg-card p-4">
        <FieldRow label="Category">{categoryLabel(detail.category)}</FieldRow>
        <FieldRow label="Priority">
          <PriorityBadge priority={detail.priority} />
        </FieldRow>
      </section>
      <section aria-label="Description" className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Description</h3>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{detail.description}</p>
      </section>
      <section aria-label="Developer notes" className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Developer Notes</h3>
        {detail.developer_notes ? (
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{detail.developer_notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No notes yet.</p>
        )}
      </section>
      <section aria-label="Attachments" className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Attachments</h3>
        <TicketAttachments attachments={detail.attachments} />
      </section>
    </div>
  )
}
