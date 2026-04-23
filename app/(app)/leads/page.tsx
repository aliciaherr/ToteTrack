import {
  getLeads,
  getLeadDetail,
  getLeadNotes,
  type LeadListStatus,
} from '@/db/queries/leads'
import { LeadNotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/validators/uuid'
import { parseInitialMode } from '@/lib/parse-initial-mode'
import LeadLayout from '@/components/leads/LeadLayout'
import PageTransition from '@/components/shell/PageTransition'

const VALID_STATUSES: readonly LeadListStatus[] = ['all', 'hot', 'warm', 'cold']

interface LeadsPageProps {
  searchParams: {
    id?: string
    status?: string
    search?: string
    new?: string
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
 * Leads list route. Reads `status`, `search`, `id`, and `new` from searchParams,
 * validates each, then fetches the lead list and (when selected) the detail +
 * notes in parallel. `?new=1` opens the create form on mount and takes
 * precedence over `?id=` (selectedId is dropped when both are present).
 */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const status = parseStatus(searchParams.status)
  const search = searchParams.search ?? ''
  const initialMode = parseInitialMode(searchParams.new, 'new-lead')
  // `?new=1` takes precedence over `?id=` per PRD Feature 8 — when both are
  // present, the New Lead form opens and the existing selection is dropped.
  const selectedId = initialMode === 'new-lead' ? null : parseUuid(searchParams.id)

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
        initialMode={initialMode}
      />
    </PageTransition>
  )
}
