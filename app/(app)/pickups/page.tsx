import {
  getPickups,
  getPickupDetail,
  type PickupDetail,
  type PickupListStatus,
} from '@/db/queries/pickups'
import { getActiveCustomersForSelect } from '@/db/queries/customers'
import { PickupNotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/validators/uuid'
import { parseInitialMode } from '@/lib/parse-initial-mode'
import PickupLayout from '@/components/pickups/PickupLayout'
import PageTransition from '@/components/shell/PageTransition'

// SEC-02 — the whitelist that keeps a hand-typed `?status=` off the query.
// `db/queries/pickups.ts` interpolates the filter straight into
// `AND p.status = $1`, and Postgres cannot cast an unknown label to the
// `pickup_status` enum: an un-whitelisted value 500s the route instead of
// filtering. Anything not in this list falls back to 'all'.
const VALID_STATUSES: readonly PickupListStatus[] = [
  'all',
  'scheduled',
  'completed',
  'cancelled',
]

interface PickupsPageProps {
  searchParams: Promise<{
    id?: string
    status?: string
    search?: string
    new?: string
    customerId?: string
  }>
}

function parseStatus(value: string | undefined): PickupListStatus {
  return VALID_STATUSES.includes(value as PickupListStatus)
    ? (value as PickupListStatus)
    : 'all'
}

// Same boundary rule for the two id params: a non-UUID `?id=` would reach
// `WHERE p.id = $1` and fail the `uuid` cast, so it is dropped here rather
// than trusted (SEC-02).
function parseUuid(value: string | undefined): string | null {
  return isUuid(value) ? value : null
}

async function loadPickupDetail(pickupId: string): Promise<PickupDetail | null> {
  try {
    return await getPickupDetail(pickupId)
  } catch (error) {
    // Stale or cancelled-away id is not a server error — surface as "no
    // selection". Other errors (DatabaseError) bubble to the Next.js error
    // boundary.
    if (error instanceof PickupNotFoundError) return null
    throw error
  }
}

/**
 * Pickups list route. Reads filter + search + form deep-link state from query
 * params (`status`, `search`, `id`, `new`, `customerId`), validates each at the
 * boundary, and fetches pickups + detail + the customer selector list in
 * parallel. The list is unbounded — every matching pickup renders in one
 * scroll. `?new=1` opens the create form in the right panel;
 * `?customerId=[uuid]` pre-selects and locks the customer field.
 */
export default async function PickupsPage(props: PickupsPageProps) {
  const searchParams = await props.searchParams
  const status = parseStatus(searchParams.status)
  const search = searchParams.search?.trim() ?? ''
  const selectedId = parseUuid(searchParams.id)
  const lockedCustomerId = parseUuid(searchParams.customerId)
  const initialMode = parseInitialMode(searchParams.new, 'new-pickup')

  const [listResult, detail, customers] = await Promise.all([
    getPickups({ status, search }),
    selectedId ? loadPickupDetail(selectedId) : Promise.resolve(null),
    getActiveCustomersForSelect(),
  ])

  return (
    <PageTransition>
      <PickupLayout
        pickups={listResult.rows}
        status={status}
        search={search}
        selectedId={selectedId}
        detail={detail}
        customers={customers}
        initialMode={initialMode}
        lockedCustomerId={lockedCustomerId}
      />
    </PageTransition>
  )
}
