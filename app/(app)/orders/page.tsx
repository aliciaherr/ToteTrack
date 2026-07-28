import {
  getOrders,
  getOrderDetail,
  type OrderDetail,
  type OrderListStatus,
} from '@/db/queries/orders'
import { getActiveCustomersForSelect } from '@/db/queries/customers'
import { OrderNotFoundError } from '@/lib/errors'
import { parseInitialMode } from '@/lib/parse-initial-mode'
import OrderLayout from '@/components/orders/OrderLayout'
import PageTransition from '@/components/shell/PageTransition'

// `pending` is gone (v2 model). `invoiced` is folded into the `completed`
// filter — `getOrders` matches `status IN ('completed', 'invoiced')` on that
// branch — so it's no longer a separately-selectable filter from the URL.
const VALID_STATUSES: readonly OrderListStatus[] = [
  'all',
  'scheduled',
  'completed',
  'cancelled',
]

// RFC 4122 UUID format — used to reject malformed `?id=` and `?customerId=`
// values before querying Postgres (SEC-02 — validate at the boundary).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface OrdersPageProps {
  searchParams: {
    id?: string
    status?: string
    search?: string
    new?: string
    customerId?: string
  }
}

function parseStatus(value: string | undefined): OrderListStatus {
  return VALID_STATUSES.includes(value as OrderListStatus)
    ? (value as OrderListStatus)
    : 'all'
}

function parseUuid(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null
}

async function loadOrderDetail(orderId: string): Promise<OrderDetail | null> {
  try {
    return await getOrderDetail(orderId)
  } catch (error) {
    // Stale or deleted id is not a server error — surface as "no selection".
    // Other errors (DatabaseError) bubble to the Next.js error boundary.
    if (error instanceof OrderNotFoundError) return null
    throw error
  }
}

/**
 * Orders list route. Reads filter + search + form deep-link state from query
 * params (`status`, `search`, `id`, `new`, `customerId`), validates each, and
 * fetches orders + detail + the customer selector list in parallel. The list
 * is unbounded — every matching order renders in one scroll.
 * `?new=1` opens the create form in the right panel; `?customerId=[uuid]`
 * pre-selects and locks the customer field.
 */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const status = parseStatus(searchParams.status)
  const search = searchParams.search?.trim() ?? ''
  const selectedId = parseUuid(searchParams.id)
  const lockedCustomerId = parseUuid(searchParams.customerId)
  const initialMode = parseInitialMode(searchParams.new, 'new-order')

  const [listResult, detail, customers] = await Promise.all([
    getOrders({ status, search }),
    selectedId ? loadOrderDetail(selectedId) : Promise.resolve(null),
    getActiveCustomersForSelect(),
  ])

  return (
    <PageTransition>
      <OrderLayout
        orders={listResult.rows}
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
