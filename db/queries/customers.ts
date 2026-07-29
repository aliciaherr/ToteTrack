import { sql, type SQL } from 'drizzle-orm'
import { subDays, startOfYear, format } from 'date-fns'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import {
  CUSTOMER_LIST_QUERY_BODY,
  customerOrdersQuery,
  customerVolumeAveragesQuery,
} from './customers.sql'
import {
  assembleVolumeOverview,
  type VolumeAveragesRow,
  type VolumeOverview,
} from './customers.volume'

export {
  EMPTY_VOLUME_OVERVIEW,
  type VolumeBucket,
  type VolumeOverview,
} from './customers.volume'

export {
  getActiveCustomersForSelect,
  type CustomerAddressOption,
  type CustomerSelectOption,
} from './customers.select'

export {
  getCustomerDetail,
  type CustomerContactRow,
  type CustomerDetail,
} from './customers.detail'

export type CustomerListSort = 'alphabetical' | 'order_count' | 'need_to_contact'
export type CustomerListStatus = 'active' | 'inactive'

export type CustomerOrdersWindow = '1M' | '3M' | '6M' | '1Y' | 'YTD'

// Window-to-days lookup. YTD uses startOfYear instead, so it has no entry here.
const WINDOW_DAYS: Record<Exclude<CustomerOrdersWindow, 'YTD'>, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
}

export type PoStatus = 'scheduled' | 'completed' | 'cancelled' | 'invoiced'

export interface GetCustomersFilters {
  status?: CustomerListStatus
  search?: string
  sort?: CustomerListSort
}

export interface CustomerListRow {
  id: string
  company_name: string
  status: CustomerListStatus
  primary_contact_name: string | null
  primary_contact_role: string | null
  last_completed_date: string | null
  completed_order_count: number
  overdue_days: number | null
}

export interface CustomerOrderRow {
  id: string
  po_number: string
  status: PoStatus
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
  requested_delivery_date: string | null
  backhaul: boolean
}

function buildOrderClause(sort: CustomerListSort): SQL {
  switch (sort) {
    case 'order_count':
      return sql`completed_order_count DESC, company_name ASC`
    case 'need_to_contact':
      // Bare alias only — Postgres rejects SELECT-list aliases inside ORDER BY
      // expressions (e.g. wrapping `overdue_days` in a CASE). DESC NULLS LAST
      // already orders positives → zero → negatives → NULL.
      return sql`overdue_days DESC NULLS LAST, company_name ASC`
    case 'alphabetical':
    default:
      return sql`company_name ASC`
  }
}

function buildSearchClause(search: string | undefined): SQL {
  const trimmed = search?.trim()
  if (!trimmed) return sql``
  return sql`AND c.company_name ILIKE ${`%${trimmed}%`}`
}

function buildCustomersQuery(args: {
  status: CustomerListStatus
  search: string | undefined
  sort: CustomerListSort
}): SQL {
  return sql`
    ${CUSTOMER_LIST_QUERY_BODY}
    WHERE c.status = ${args.status}
      ${buildSearchClause(args.search)}
    ORDER BY ${buildOrderClause(args.sort)}
  `
}

/**
 * Loads customers for the list panel with computed contact-needed metadata.
 * Default filters: status='active', sort='alphabetical', no search.
 *
 * `overdue_days` is computed per row from order history:
 *  - null when the customer has no completed orders OR no manual frequency and < 2 completed orders
 *  - >0 when contact is overdue (drives the CONTACT NEEDED badge)
 *  - ≤0 when not yet due
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCustomers(
  filters: GetCustomersFilters = {},
): Promise<CustomerListRow[]> {
  const status = filters.status ?? 'active'
  const sort = filters.sort ?? 'alphabetical'
  const query = buildCustomersQuery({ status, search: filters.search, sort })

  try {
    const result = await db.execute(query)
    return result as unknown as CustomerListRow[]
  } catch (cause) {
    console.error('getCustomers: query failed', {
      operation: 'getCustomers',
      filters: { status, sort, hasSearch: Boolean(filters.search?.trim()) },
      cause,
    })
    throw new DatabaseError('getCustomers', 'Failed to load customer list', { cause })
  }
}

/**
 * Computes the inclusive lower-bound date (formatted yyyy-MM-dd) for a given
 * order-history window, relative to `today`. Pure — exposed for testing.
 *
 *  - `1M` / `3M` / `6M` / `1Y` → today minus N days (30 / 90 / 180 / 365)
 *  - `YTD`                     → Jan 1 of the current year
 */
export function computeWindowStartDate(
  window: CustomerOrdersWindow,
  today: Date,
): string {
  const start = window === 'YTD' ? startOfYear(today) : subDays(today, WINDOW_DAYS[window])
  return format(start, 'yyyy-MM-dd')
}

/**
 * Loads the per-PO volume profile for a single customer: AVG(qty_<size>_<type>)
 * FILTERED to POs that included that combo (qty > 0) AND status IN
 * ('completed', 'invoiced'). Missing combinations resolve to 0 — a customer
 * that has never ordered 330-gallon rebottled totes returns
 * `gal330.rebottled = 0` without error. `totalAvg` is the sum of the three
 * type averages within the same size and is exposed so the UI can render
 * each type as a share of the whole without recomputing.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCustomerVolumeOverview(
  customerId: string,
): Promise<VolumeOverview> {
  try {
    const result = await db.execute(customerVolumeAveragesQuery(customerId))
    const row = (result as unknown as VolumeAveragesRow[])[0]
    return assembleVolumeOverview(row)
  } catch (cause) {
    console.error('getCustomerVolumeOverview: query failed', {
      operation: 'getCustomerVolumeOverview',
      customerId,
      cause,
    })
    throw new DatabaseError(
      'getCustomerVolumeOverview',
      'Failed to load volume overview',
      { cause },
    )
  }
}

/**
 * Loads orders for a single customer, filtered to a time window relative to
 * today. Sorted by `requested_delivery_date` DESC. Returns `[]` when the
 * customer has no orders in the window.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCustomerOrders(
  customerId: string,
  window: CustomerOrdersWindow,
): Promise<CustomerOrderRow[]> {
  const startDate = computeWindowStartDate(window, new Date())
  try {
    const result = await db.execute(customerOrdersQuery(customerId, startDate))
    return result as unknown as CustomerOrderRow[]
  } catch (cause) {
    console.error('getCustomerOrders: query failed', {
      operation: 'getCustomerOrders',
      customerId,
      window,
      cause,
    })
    throw new DatabaseError('getCustomerOrders', 'Failed to load customer orders', { cause })
  }
}
