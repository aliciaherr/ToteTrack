'use client'

import { useRouter } from 'next/navigation'
import NewTicketForm from './NewTicketForm'
import TicketList from './TicketList'
import TicketDetail from './TicketDetail'
import type { TicketDetail as TicketDetailType, TicketListRow } from '@/db/queries/support'

interface SupportLayoutProps {
  tickets: TicketListRow[]
  selectedId: string | null
  detail: TicketDetailType | null
}

/**
 * Two-panel shell for the Support screen. Left: `TicketList` with the
 * currently-selected row highlighted. Right: `TicketDetail` when a
 * ticket is selected via `?id=`, otherwise the `NewTicketForm`.
 * Navigation is URL-driven — `onNew` simply clears the selection so the
 * form takes the panel back. Mirrors the LeadLayout / InvoiceLayout
 * structure.
 */
export default function SupportLayout({ tickets, selectedId, detail }: SupportLayoutProps) {
  const router = useRouter()
  const handleNew = () => router.push('/support')

  return (
    <div className="h-[calc(100vh-0.75rem)] grid grid-cols-1 lg:grid-cols-[minmax(320px,38%)_1fr]">
      <aside aria-label="Support tickets">
        <TicketList tickets={tickets} selectedId={selectedId} onNew={handleNew} />
      </aside>
      <section aria-label="Support detail" className="bg-app-bg overflow-y-auto">
        {selectedId ? (
          <TicketDetail detail={detail} backHref="/support" />
        ) : (
          <NewTicketForm />
        )}
      </section>
    </div>
  )
}
