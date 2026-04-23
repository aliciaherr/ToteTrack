import {
  getLeads,
  getLeadDetail,
  getLeadNotes,
  type LeadListStatus,
} from '@/db/queries/leads'
import { LeadNotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/validators/uuid'
import LeadLayout from '@/components/leads/LeadLayout'
import PageTransition from '@/components/shell/PageTransition'

const VALID_STATUSES: readonly LeadListStatus[] = ['all', 'hot', 'warm', 'cold']

interface LeadsPageProps {
  searchParams: {
    id?: string
    status?: string
    search?: string
  }
}

function parseStatus(value: string | undefined): LeadListStatus {
  return VALID_STATUSES.includes(value as LeadListStatus)
    ? (value as LeadListStatus)
    : 'all'
}

function parseUuid(value: string | undefined): string | null {
  return isUuid(value) ? value : null
}

async function loadLeadDetail(leadId: string) {
  try {
    return await getLeadDetail(leadId)
  } catch (error) {
    if (error instanceof LeadNotFoundError) return null
    throw error
  }
}

/**
 * Leads list route. Validates `status`, `search`, and `id` from searchParams,
 * then fetches the lead list and (when selected) the detail + notes in parallel.
 */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const status = parseStatus(searchParams.status)
  const search = searchParams.search ?? ''
  const selectedId = parseUuid(searchParams.id)

  const [leads, detail, notes] = await Promise.all([
    getLeads({ status, search }),
    selectedId ? loadLeadDetail(selectedId) : Promise.resolve(null),
    selectedId ? getLeadNotes(selectedId) : Promise.resolve([]),
  ])

  return (
    <PageTransition>
      <LeadLayout
        leads={leads}
        selectedId={selectedId}
        status={status}
        search={search}
        detail={detail}
        notes={notes}
      />
    </PageTransition>
  )
}
