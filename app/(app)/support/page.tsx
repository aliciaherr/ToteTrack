import {
  getTickets,
  getTicketDetail,
  type TicketDetail as TicketDetailType,
} from '@/db/queries/support'
import { TicketNotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/validators/uuid'
import SupportLayout from '@/components/support/SupportLayout'
import PageTransition from '@/components/shell/PageTransition'

interface SupportPageProps {
  searchParams: {
    id?: string
  }
}

async function loadTicketDetail(ticketId: string): Promise<TicketDetailType | null> {
  try {
    return await getTicketDetail(ticketId)
  } catch (error) {
    // Stale or deleted id is not a server error — surface as "no selection".
    // Other errors (DatabaseError) bubble to the Next.js error boundary.
    if (error instanceof TicketNotFoundError) return null
    throw error
  }
}

/**
 * Support route. Validates `id` from searchParams as a UUID, then fetches
 * the ticket list and (when selected) the detail + attachments in parallel
 * so the screen renders on a single server round-trip. Auth is enforced
 * by the surrounding `app/(app)/layout.tsx` guard.
 */
export default async function SupportPage({ searchParams }: SupportPageProps) {
  const selectedId = isUuid(searchParams.id) ? searchParams.id : null

  const [tickets, detail] = await Promise.all([
    getTickets(),
    selectedId ? loadTicketDetail(selectedId) : Promise.resolve(null),
  ])

  return (
    <PageTransition>
      <SupportLayout tickets={tickets} selectedId={selectedId} detail={detail} />
    </PageTransition>
  )
}
