import {
  getCustomers,
  getCustomerDetail,
  getCustomerOrders,
  getCustomerVolumeOverview,
  EMPTY_VOLUME_OVERVIEW,
  type CustomerDetail,
  type CustomerListSort,
  type CustomerListStatus,
  type CustomerOrderRow,
  type CustomerOrdersWindow,
  type VolumeOverview,
} from '@/db/queries/customers'
import {
  getCustomerPickups,
  getCustomerUnscheduledPickupCount,
  type CustomerPickupRow,
  type CustomerPickupsWindow,
} from '@/db/queries/pickups'
import { CustomerNotFoundError } from '@/lib/errors'
import { parseInitialMode } from '@/lib/parse-initial-mode'
import CustomerLayout from '@/components/customers/CustomerLayout'
import PageTransition from '@/components/shell/PageTransition'

const VALID_SORTS: readonly CustomerListSort[] = ['alphabetical', 'order_count', 'need_to_contact']
const VALID_WINDOWS: readonly CustomerOrdersWindow[] = ['1M', '3M', '6M', '1Y', 'YTD']
const DEFAULT_WINDOW: CustomerOrdersWindow = '1M'

// RFC 4122 UUID format — used to reject malformed `?id=` values before
// querying Postgres (SEC-02 — validate inputs at the system boundary).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CustomersPageProps {
  searchParams: {
    id?: string
    status?: string
    search?: string
    sort?: string
    window?: string
    // Pickup History's own window param, kept separate from `window` so the two
    // panels' tabs never drive each other. Typed `string | string[]` because
    // that is what Next.js actually hands over for a repeated param
    // (`?pwindow=1M&pwindow=3M`) — see `parseWindow`.
    pwindow?: string | string[]
    new?: string
  }
}

function parseStatus(value: string | undefined): CustomerListStatus {
  return value === 'inactive' ? 'inactive' : 'active'
}

function parseSort(value: string | undefined): CustomerListSort {
  return VALID_SORTS.includes(value as CustomerListSort)
    ? (value as CustomerListSort)
    : 'alphabetical'
}

// SEC-02 — the whitelist that keeps a hand-typed `?window=` / `?pwindow=` off
// the query. `db/queries/pickups.ts` does no validation of its own at its
// boundary, so an un-whitelisted value must never leave this file.
//
// The value is typed `string | string[]` because Next.js hands a repeated param
// (`?pwindow=1M&pwindow=3M`) through as an array. Membership is tested against
// the raw value and no string-only method is ever called on it, so an array
// simply fails the test and falls back to the default — the `?.trim()` crash
// pattern (a `?.` guards null, not the wrong type) cannot occur here.
function parseWindow(value: string | string[] | undefined): CustomerOrdersWindow {
  return VALID_WINDOWS.includes(value as CustomerOrdersWindow)
    ? (value as CustomerOrdersWindow)
    : DEFAULT_WINDOW
}

function parseSelectedId(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null
}

interface DetailResult {
  detail: CustomerDetail | null
  orders: CustomerOrderRow[]
  pickups: CustomerPickupRow[]
  // Undated open pickups. Not a subset of `pickups` — those are window-filtered
  // and every window excludes a NULL date — so it travels as its own number.
  unscheduledPickupCount: number
  volumeOverview: VolumeOverview
}

const EMPTY_DETAIL_RESULT: DetailResult = {
  detail: null,
  orders: [],
  pickups: [],
  unscheduledPickupCount: 0,
  volumeOverview: EMPTY_VOLUME_OVERVIEW,
}

async function loadCustomerDetail(
  customerId: string,
  window: CustomerOrdersWindow,
  pickupWindow: CustomerPickupsWindow,
): Promise<DetailResult> {
  try {
    const [detail, orders, pickups, unscheduledPickupCount, volumeOverview] =
      await Promise.all([
        getCustomerDetail(customerId),
        getCustomerOrders(customerId, window),
        getCustomerPickups(customerId, pickupWindow),
        // Rides the existing parallel batch rather than a client fetch: no extra
        // wall-clock cost, no client JS, and the number is already server-side.
        getCustomerUnscheduledPickupCount(customerId),
        getCustomerVolumeOverview(customerId),
      ])
    return { detail, orders, pickups, unscheduledPickupCount, volumeOverview }
  } catch (error) {
    // Stale or deleted id is not a server error — surface as "no selection".
    // Other errors (DatabaseError) bubble to the Next.js error boundary.
    if (error instanceof CustomerNotFoundError) return EMPTY_DETAIL_RESULT
    throw error
  }
}

/**
 * Customers list route. Reads filter + selection + form-deep-link state from
 * query params (`status`, `search`, `sort`, `id`, `window`, `pwindow`, `new`),
 * validates each, and fetches list rows + (when an `id` is selected) detail +
 * orders + pickups + volume overview in parallel. Order History and Pickup
 * History own separate window params (`window` / `pwindow`) so switching one
 * panel's tabs leaves the other alone. `?new=1` opens the create form on mount and
 * takes precedence over `?id=` (selectedId is dropped when both are present).
 * Unknown values fall back to defaults.
 */
export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const status = parseStatus(searchParams.status)
  const search = searchParams.search ?? ''
  const sort = parseSort(searchParams.sort)
  const window = parseWindow(searchParams.window)
  const pickupWindow = parseWindow(searchParams.pwindow)
  const initialMode = parseInitialMode(searchParams.new, 'new-customer')
  // `?new=1` takes precedence over `?id=` per PRD Feature 8 — when both are
  // present, the New Customer form opens and the existing selection is dropped.
  const selectedId =
    initialMode === 'new-customer' ? null : parseSelectedId(searchParams.id)

  const [customers, detailResult] = await Promise.all([
    getCustomers({ status, search, sort }),
    selectedId
      ? loadCustomerDetail(selectedId, window, pickupWindow)
      : Promise.resolve(EMPTY_DETAIL_RESULT),
  ])

  return (
    <PageTransition>
      <CustomerLayout
        customers={customers}
        selectedId={selectedId}
        status={status}
        search={search}
        sort={sort}
        detail={detailResult.detail}
        orders={detailResult.orders}
        window={window}
        pickups={detailResult.pickups}
        pickupWindow={pickupWindow}
        unscheduledPickupCount={detailResult.unscheduledPickupCount}
        volumeOverview={detailResult.volumeOverview}
        initialMode={initialMode}
      />
    </PageTransition>
  )
}
