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

function parseWindow(value: string | undefined): CustomerOrdersWindow {
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
  volumeOverview: VolumeOverview
}

const EMPTY_DETAIL_RESULT: DetailResult = {
  detail: null,
  orders: [],
  volumeOverview: EMPTY_VOLUME_OVERVIEW,
}

async function loadCustomerDetail(
  customerId: string,
  window: CustomerOrdersWindow,
): Promise<DetailResult> {
  try {
    const [detail, orders, volumeOverview] = await Promise.all([
      getCustomerDetail(customerId),
      getCustomerOrders(customerId, window),
      getCustomerVolumeOverview(customerId),
    ])
    return { detail, orders, volumeOverview }
  } catch (error) {
    // Stale or deleted id is not a server error — surface as "no selection".
    // Other errors (DatabaseError) bubble to the Next.js error boundary.
    if (error instanceof CustomerNotFoundError) return EMPTY_DETAIL_RESULT
    throw error
  }
}

/**
 * Customers list route. Reads filter + selection + form-deep-link state from
 * query params (`status`, `search`, `sort`, `id`, `window`, `new`), validates
 * each, and fetches list rows + (when an `id` is selected) detail + orders +
 * volume overview in parallel. `?new=1` opens the create form on mount and
 * takes precedence over `?id=` (selectedId is dropped when both are present).
 * Unknown values fall back to defaults.
 */
export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const status = parseStatus(searchParams.status)
  const search = searchParams.search ?? ''
  const sort = parseSort(searchParams.sort)
  const window = parseWindow(searchParams.window)
  const initialMode = parseInitialMode(searchParams.new, 'new-customer')
  // `?new=1` takes precedence over `?id=` per PRD Feature 8 — when both are
  // present, the New Customer form opens and the existing selection is dropped.
  const selectedId =
    initialMode === 'new-customer' ? null : parseSelectedId(searchParams.id)

  const [customers, detailResult] = await Promise.all([
    getCustomers({ status, search, sort }),
    selectedId ? loadCustomerDetail(selectedId, window) : Promise.resolve(EMPTY_DETAIL_RESULT),
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
        volumeOverview={detailResult.volumeOverview}
        initialMode={initialMode}
      />
    </PageTransition>
  )
}
