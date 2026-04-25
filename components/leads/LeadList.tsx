'use client'

import { useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildListItemMotionProps } from '@/lib/list-animation'
import type { LeadListRow, LeadListStatus } from '@/db/queries/leads'
import { leadStatusBadgeClasses } from './leadStatusStyles'
import LeadStatusTabs from './LeadStatusTabs'

interface LeadListProps {
  leads: LeadListRow[]
  selectedId: string | null
  status: LeadListStatus
  search: string
  onNew?: () => void
}

function buildHref(updates: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const query = params.toString()
  return query ? `/leads?${query}` : '/leads'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize transition-colors duration-200 ease-in-out ${leadStatusBadgeClasses(status)}`}
    >
      {status}
    </span>
  )
}

function LeadRow({
  lead,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: {
  lead: LeadListRow
  isSelected: boolean
  href: string
  animationIndex: number
  shouldReduceMotion: boolean
}) {
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
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
            {lead.company && (
              <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
            )}
          </div>
          <StatusBadge status={lead.status} />
        </div>
        {lead.next_follow_up_date && (
          <p className="mt-1 text-xs text-muted-foreground">
            Follow-up: {lead.next_follow_up_date}
          </p>
        )}
      </Link>
    </motion.li>
  )
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {hasSearch ? 'No leads match that search.' : 'No leads yet. Add your first lead.'}
    </div>
  )
}

interface LeadListHeaderProps {
  search: string
  status: LeadListStatus
  onSearchChange: (value: string) => void
  onTabChange: (value: LeadListStatus) => void
  onNew?: () => void
}

function LeadListHeader({ search, status, onSearchChange, onTabChange, onNew }: LeadListHeaderProps) {
  return (
    <div className="pl-20 pr-4 py-4 border-b border-border space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            defaultValue={search}
            placeholder="Search leads..."
            aria-label="Search leads"
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
        <Button className="min-h-[44px]" aria-label="Add new lead" onClick={onNew}>
          + New
        </Button>
      </div>

      <LeadStatusTabs status={status} onTabChange={onTabChange} />
    </div>
  )
}

/**
 * Left-panel lead list. Renders the search + status-tab header and a scrollable
 * list of lead rows. Tab/search changes navigate to updated URL searchParams so
 * the server component can re-fetch with the new filters. `onNew` opens the
 * create-lead form in the right panel (owned by LeadLayout).
 */
export default function LeadList({ leads, selectedId, status, search, onNew }: LeadListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = Boolean(useReducedMotion())

  const navigate = useCallback(
    (updates: { status?: LeadListStatus; search?: string }) => {
      const href = buildHref({
        status: updates.status ?? status,
        search: updates.search ?? (search || undefined),
        id: selectedId ?? undefined,
      })
      startTransition(() => router.push(href))
    },
    [router, status, search, selectedId],
  )

  const hasSearchTerm = Boolean(search.trim())

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <LeadListHeader
        search={search}
        status={status}
        onSearchChange={(value) => navigate({ search: value })}
        onTabChange={(value) => navigate({ status: value })}
        onNew={onNew}
      />
      <div
        className={`flex-1 overflow-y-auto transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      >
        {leads.length === 0 ? (
          <EmptyState hasSearch={hasSearchTerm} />
        ) : (
          <ul role="list">
            {leads.map((lead, index) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                isSelected={selectedId === lead.id}
                animationIndex={index}
                shouldReduceMotion={shouldReduceMotion}
                href={buildHref({
                  id: lead.id,
                  status,
                  search: search || undefined,
                })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
