'use client'

import { useRouter } from 'next/navigation'
import LeadNextAction from './LeadNextAction'
import LeadNotesSection from './LeadNotesSection'
import { leadStatusBadgeClasses } from './leadStatusStyles'
import type { LeadDetail as LeadDetailType, LeadNote } from '@/db/queries/leads'

interface LeadDetailProps {
  detail: LeadDetailType
  notes: LeadNote[]
  onEdit?: () => void
  onConvert?: () => void
}

export function LeadDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select a lead to view details.
    </div>
  )
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
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

function EngagementSection({ detail }: { detail: LeadDetailType }) {
  return (
    <section aria-label="Engagement" className="rounded-lg border border-border bg-card p-4">
      <FieldRow label="Last Contact">{formatDate(detail.updated_at)}</FieldRow>
      <FieldRow label="Lead Source">{detail.lead_source ?? '—'}</FieldRow>
      <FieldRow label="Status">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize transition-colors duration-200 ease-in-out ${leadStatusBadgeClasses(detail.status)}`}>
          {detail.status}
        </span>
      </FieldRow>
    </section>
  )
}

/**
 * Right-panel lead detail view. Renders header, engagement info, next-action
 * form, append-only notes, and the Convert-to-Customer action. Returns the
 * empty state when no lead is selected.
 */
const HEADER_BTN_CLASS =
  'inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors'

export default function LeadDetail({ detail, notes, onEdit, onConvert }: LeadDetailProps) {
  const router = useRouter()

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">
            {detail.name}
          </h2>
          {(detail.title || detail.company) && (
            <p className="text-sm text-muted-foreground truncate">
              {[detail.title, detail.company].filter(Boolean).join(' · ')}
            </p>
          )}
          {(detail.email || detail.phone) && (
            <p className="text-sm text-muted-foreground">
              {detail.email && <span>{detail.email}</span>}
              {detail.email && detail.phone && <span className="mx-1">·</span>}
              {detail.phone && <span>{detail.phone}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {detail.phone && (
            <a href={`sms:${detail.phone}`} className={HEADER_BTN_CLASS} aria-label={`Text ${detail.phone}`}>
              Text
            </a>
          )}
          {detail.email && (
            <a href={`mailto:${detail.email}`} className={HEADER_BTN_CLASS} aria-label={`Email ${detail.email}`}>
              Email
            </a>
          )}
          {onEdit && (
            <button onClick={onEdit} className={HEADER_BTN_CLASS}>
              Edit
            </button>
          )}
          {onConvert && (
            <button
              onClick={onConvert}
              className="inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Convert
            </button>
          )}
        </div>
      </div>
      <EngagementSection detail={detail} />
      <LeadNextAction
        leadId={detail.id}
        current={detail}
        onSaved={() => router.refresh()}
      />
      <LeadNotesSection
        leadId={detail.id}
        notes={notes}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
