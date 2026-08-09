'use client'

import { useRouter } from 'next/navigation'
import LeadNextAction from './LeadNextAction'
import LeadNotesSection from './LeadNotesSection'
import { leadStatusBadgeClasses } from './leadStatusStyles'
import { isPresent, isReachable, mailtoHref, smsHref } from '@/lib/contact-links'
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

const HEADER_BTN_CLASS =
  'inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors'

/**
 * Name, title/company, and the two contact channels as plain text.
 *
 * Split out of `LeadDetail` alongside `ContactActions` to keep that function
 * inside the 50-line cap (CQ-01), on the same seam `CustomerContactCard` splits
 * on: identity text on one side, the action buttons on the other.
 *
 * `isPresent`/`isReachable` rather than truthiness, matching the buttons — a
 * whitespace-only column otherwise opened a `<p>` holding one blank span and no
 * button, which reads as the app having lost the data rather than never having
 * had it.
 */
function LeadIdentity({ detail }: { detail: LeadDetailType }) {
  return (
    <div className="min-w-0 space-y-1">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">
        {detail.name}
      </h2>
      {(detail.title || detail.company) && (
        <p className="text-sm text-muted-foreground truncate">
          {[detail.title, detail.company].filter(Boolean).join(' · ')}
        </p>
      )}
      {isReachable(detail) && (
        <p className="text-sm text-muted-foreground">
          {isPresent(detail.email) && <span>{detail.email}</span>}
          {isPresent(detail.email) && isPresent(detail.phone) && <span className="mx-1">·</span>}
          {isPresent(detail.phone) && <span>{detail.phone}</span>}
        </p>
      )}
    </div>
  )
}

/**
 * Text / Email buttons for the lead.
 *
 * Hrefs come from `lib/contact-links.ts`, never built inline: the lead columns
 * are hand-typed free text, and a raw `?cc=` sitting in one would open a draft
 * with a silent CC that reads as entirely normal. `isPresent` rather than
 * truthiness so a whitespace-only column does not render a live button to
 * nowhere.
 *
 * The accessible name is the lead's *name*, not the stored channel — same
 * reasoning as `CustomerContactCard`'s `ContactActions`. `Text ${phone}`
 * announced the raw column while the href navigated to the sanitized number, so
 * a screen-reader user heard one number and dialled another. Reading out the
 * sanitized digits would be truthful and unusable; the name is neither a claim
 * about the target nor able to fall out of step with it.
 *
 * @param detail The lead whose name and contact columns label and target the
 * buttons.
 */
function ContactActions({ detail }: { detail: LeadDetailType }) {
  return (
    <>
      {isPresent(detail.phone) && (
        <a href={smsHref(detail.phone)} className={HEADER_BTN_CLASS} aria-label={`Text ${detail.name}`}>
          Text
        </a>
      )}
      {isPresent(detail.email) && (
        <a href={mailtoHref(detail.email)} className={HEADER_BTN_CLASS} aria-label={`Email ${detail.name}`}>
          Email
        </a>
      )}
    </>
  )
}

/**
 * Right-panel lead detail view. Renders header, engagement info, next-action
 * form, append-only notes, and the Convert-to-Customer action. Returns the
 * empty state when no lead is selected.
 */
export default function LeadDetail({ detail, notes, onEdit, onConvert }: LeadDetailProps) {
  const router = useRouter()

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <LeadIdentity detail={detail} />
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <ContactActions detail={detail} />
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
