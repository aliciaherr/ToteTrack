'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronDown, Mail, MessageSquare } from 'lucide-react'
import { collapsibleVariants } from '@/lib/animations'
import type { CustomerContactRow } from '@/db/queries/customers'

interface CustomerContactCardProps {
  contacts: CustomerContactRow[]
  overdueDays: number | null
  lastCompletedDate: string | null
}

const ACTION_BTN_CLASS =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors text-foreground'

function ContactActions({ email, phone }: { email: string | null; phone: string | null }) {
  if (!email && !phone) return null
  return (
    <div className="flex items-center gap-2 shrink-0">
      {phone ? (
        <a href={`sms:${phone}`} className={ACTION_BTN_CLASS} aria-label={`Text ${phone}`}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Text
        </a>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} className={ACTION_BTN_CLASS} aria-label={`Email ${email}`}>
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
        <div className="mt-0.5 flex flex-col gap-0.5 text-sm text-secondary">
          {contact.email ? <span className="truncate">{contact.email}</span> : null}
          {contact.phone ? <span>{contact.phone}</span> : null}
        </div>
      </div>
      <ContactActions email={contact.email} phone={contact.phone} />
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
