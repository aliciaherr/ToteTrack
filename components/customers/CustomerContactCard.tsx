'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronDown, Mail, MessageSquare } from 'lucide-react'
import { collapsibleVariants } from '@/lib/animations'
import { isPresent, isReachable, mailtoHref, smsHref } from '@/lib/contact-links'
import type { CustomerContactRow } from '@/db/queries/customers'

interface CustomerContactCardProps {
  contacts: CustomerContactRow[]
  overdueDays: number | null
  lastCompletedDate: string | null
}

const ACTION_BTN_CLASS =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors text-foreground'

/**
 * Text / Email buttons for one contact.
 *
 * Hrefs come from `lib/contact-links` rather than being interpolated here. Both
 * columns are hand-typed free text: raw interpolation let a stored
 * `dana@acme.test?cc=rival@competitor.test` open a draft with a silent CC, and
 * `isPresent` (not truthiness) is what stops a whitespace-only field from
 * rendering a button that goes nowhere.
 *
 * The accessible name is the contact's *name*, not the stored channel. Echoing
 * the column (`Text ${phone}`) announced one number while the href navigated to
 * a different, sanitized one — a screen-reader user heard `555-010-2030 ext 12`
 * and dialled `5550102030`. Announcing the sanitized value instead would be
 * truthful but useless: a bare digit run tells nobody who is being texted, and
 * it still reads as a claim about a target the OS may rewrite again. The name
 * cannot disagree with the href because it is not a claim about the href, and it
 * is the thing the operator is actually choosing between when a customer has
 * several contacts.
 *
 * `channels` *is* the shape `isReachable` wants, so it is passed whole rather
 * than rebuilt.
 *
 * @param name The contact's name — the accessible label for both buttons.
 * @param channels The two stored contact columns, either of which may be absent.
 */
function ContactActions({
  name,
  ...channels
}: {
  name: string
  email: string | null
  phone: string | null
}) {
  if (!isReachable(channels)) return null
  const { email, phone } = channels
  return (
    <div className="flex items-center gap-2 shrink-0">
      {isPresent(phone) ? (
        <a href={smsHref(phone)} className={ACTION_BTN_CLASS} aria-label={`Text ${name}`}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Text
        </a>
      ) : null}
      {isPresent(email) ? (
        <a href={mailtoHref(email)} className={ACTION_BTN_CLASS} aria-label={`Email ${name}`}>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Email
        </a>
      ) : null}
    </div>
  )
}

function ContactLine({ contact }: { contact: CustomerContactRow }) {
  return (
    <div className="py-2 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {contact.name}
          {contact.role ? <span className="text-secondary font-normal"> — {contact.role}</span> : null}
        </div>
        {/* `isPresent`, matching the buttons: a whitespace-only column is "not
            on file", and truthiness here rendered a visibly blank line with no
            button beside it and nothing explaining why. */}
        <div className="mt-0.5 flex flex-col gap-0.5 text-sm text-secondary">
          {isPresent(contact.email) ? <span className="truncate">{contact.email}</span> : null}
          {isPresent(contact.phone) ? <span>{contact.phone}</span> : null}
        </div>
      </div>
      <ContactActions name={contact.name} email={contact.email} phone={contact.phone} />
    </div>
  )
}

function OverdueBanner({ lastCompletedDate }: { lastCompletedDate: string | null }) {
  const label = lastCompletedDate
    ? `Last order ${lastCompletedDate} — Contact Recommended`
    : 'Contact Recommended'
  return (
    <div className="mt-3 inline-flex items-center rounded-md bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-1 uppercase tracking-wide">
      {label}
    </div>
  )
}

function MoreContactsToggle({
  isOpen,
  onToggle,
  count,
}: {
  isOpen: boolean
  onToggle: () => void
  count: number
}) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="mt-2 inline-flex items-center gap-1 min-h-[44px] text-sm font-medium text-primary hover:underline"
    >
      {isOpen ? 'Hide' : 'Show'} {count} more contact{count === 1 ? '' : 's'}
      <motion.span
        animate={{ rotate: isOpen ? 180 : 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeInOut' as const }}
        className="inline-flex"
        aria-hidden="true"
      >
        <ChevronDown className="h-4 w-4" />
      </motion.span>
    </button>
  )
}

/**
 * Contact block in the customer detail view. Renders the primary contact
 * (first entry; pre-sorted by `is_primary DESC, created_at ASC`) and an
 * overdue "Contact Recommended" banner when `overdueDays > 0`. When the
 * customer has more than one contact, a Framer Motion collapsible reveals
 * the remainder on demand.
 */
export default function CustomerContactCard({
  contacts,
  overdueDays,
  lastCompletedDate,
}: CustomerContactCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  if (contacts.length === 0) {
    return (
      <section aria-label="Contacts" className="bg-card rounded-xl border border-border p-4">
        <div className="text-sm text-muted-foreground">No contacts on file.</div>
      </section>
    )
  }

  const [primary, ...rest] = contacts
  const hasMore = rest.length > 0
  const isOverdue = overdueDays !== null && overdueDays > 0

  return (
    <section aria-label="Primary contact" className="bg-card rounded-xl border border-border p-4">
      <ContactLine contact={primary} />
      {isOverdue ? <OverdueBanner lastCompletedDate={lastCompletedDate} /> : null}
      {hasMore ? (
        <>
          <MoreContactsToggle
            isOpen={isOpen}
            onToggle={() => setIsOpen((v) => !v)}
            count={rest.length}
          />
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                key="more-contacts"
                initial={shouldReduceMotion ? false : 'collapsed'}
                animate={shouldReduceMotion ? undefined : 'expanded'}
                exit={shouldReduceMotion ? undefined : 'exit'}
                variants={shouldReduceMotion ? undefined : collapsibleVariants}
                className="overflow-hidden"
              >
                <div className="pt-1 border-t border-border mt-2">
                  {rest.map((contact) => (
                    <ContactLine key={contact.id} contact={contact} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : null}
    </section>
  )
}
