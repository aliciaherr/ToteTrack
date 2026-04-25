'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { buildListItemMotionProps } from '@/lib/list-animation'
import type { TicketListRow } from '@/db/queries/support'
import {
  categoryLabel,
  priorityBadgeClasses,
  priorityLabel,
  statusBadgeClasses,
  statusLabel,
} from './ticketBadgeStyles'

interface TicketListProps {
  tickets: TicketListRow[]
  selectedId: string | null
  onNew?: () => void
}

function buildHref(ticketId: string | null): string {
  return ticketId ? `/support?id=${ticketId}` : '/support'
}

function StatusPill({ status }: { status: TicketListRow['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors duration-200 ease-in-out ${statusBadgeClasses(status)}`}
    >
      {statusLabel(status)}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: TicketListRow['priority'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition-colors duration-200 ease-in-out ${priorityBadgeClasses(priority)}`}
    >
      {priorityLabel(priority)}
    </span>
  )
}

interface TicketRowProps {
  ticket: TicketListRow
  isSelected: boolean
  href: string
  animationIndex: number
  shouldReduceMotion: boolean
}

function TicketRow({
  ticket,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: TicketRowProps) {
  return (
    <motion.li {...buildListItemMotionProps(animationIndex, shouldReduceMotion)}>
      <Link
        href={href}
        aria-current={isSelected ? 'page' : undefined}
        className={`block px-4 py-3 border-b border-border transition-colors min-h-[44px] ${
          isSelected
            ? 'bg-primary/5 border-l-2 border-l-primary'
            : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground truncate min-w-0">{ticket.title}</p>
          <StatusPill status={ticket.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <PriorityBadge priority={ticket.priority} />
          <span className="text-xs text-muted-foreground">{categoryLabel(ticket.category)}</span>
        </div>
      </Link>
    </motion.li>
  )
}

function EmptyState() {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      No issues submitted yet.
    </div>
  )
}

function ListHeader({ onNew }: { onNew?: () => void }) {
  return (
    <div className="pl-20 pr-4 py-4 border-b border-border flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">Issues</h2>
      {onNew && (
        <Button
          type="button"
          onClick={onNew}
          aria-label="Log new issue"
          className="min-h-[44px]"
        >
          + New
        </Button>
      )}
    </div>
  )
}

/**
 * Left-panel support ticket list. Renders a scrollable list of tickets
 * (sorted newest-first by the upstream query) with the selected row
 * highlighted. Click navigates to `/support?id=[uuid]` so the right-panel
 * server render resolves the detail view. URL-driven selection mirrors
 * the LeadList / InvoiceLedger precedent — refresh and back/forward work.
 */
export default function TicketList({ tickets, selectedId, onNew }: TicketListProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <ListHeader onNew={onNew} />
      <div className="flex-1 overflow-y-auto">
        {tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <ul role="list">
            {tickets.map((ticket, index) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                isSelected={selectedId === ticket.id}
                animationIndex={index}
                shouldReduceMotion={shouldReduceMotion}
                href={buildHref(ticket.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
