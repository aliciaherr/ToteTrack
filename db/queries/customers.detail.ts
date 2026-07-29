import { db } from '@/db'
import { CustomerNotFoundError, DatabaseError } from '@/lib/errors'
import {
  customerAddressesQuery,
  customerContactsQuery,
  customerDetailQuery,
} from './customers.sql'
import type { CustomerAddressOption } from './customers.select'
import type { CustomerListStatus } from './customers'

// Detail-view slice of the customers query module. Extracted from
// `customers.ts` so that file stays under the 300-line service cap (CQ-02);
// everything here is re-exported through the `customers.ts` barrel.

export interface CustomerContactRow {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export interface CustomerDetail {
  id: string
  company_name: string
  status: CustomerListStatus
  contact_frequency_days: number | null
  auto_calculated_frequency_days: number | null
  effective_frequency_days: number | null
  notes: string | null
  contacts: CustomerContactRow[]
  addresses: CustomerAddressOption[]
  last_completed_date: string | null
  completed_order_count: number
  overdue_days: number | null
}

interface CustomerDetailStatsRow {
  id: string
  company_name: string
  status: CustomerListStatus
  contact_frequency_days: number | null
  notes: string | null
  completed_order_count: number
  last_completed_date: string | null
  auto_calculated_frequency_days: number | null
  overdue_days: number | null
}

function assembleCustomerDetail(
  stats: CustomerDetailStatsRow,
  contacts: CustomerContactRow[],
  addresses: CustomerAddressOption[],
): CustomerDetail {
  const effective = stats.contact_frequency_days ?? stats.auto_calculated_frequency_days
  return {
    id: stats.id,
    company_name: stats.company_name,
    status: stats.status,
    contact_frequency_days: stats.contact_frequency_days,
    auto_calculated_frequency_days: stats.auto_calculated_frequency_days,
    effective_frequency_days: effective,
    notes: stats.notes,
    contacts,
    addresses,
    last_completed_date: stats.last_completed_date,
    completed_order_count: stats.completed_order_count,
    overdue_days: stats.overdue_days,
  }
}

/**
 * Loads the full detail view for a single customer, including aggregated order
 * stats (last completed date, completed order count, auto-calculated contact
 * frequency, overdue days), the ordered contacts list (primary first, then by
 * created_at), and the saved delivery addresses most-recently-used first
 * (`last_used_at DESC NULLS LAST, created_at DESC` — Feature 14).
 *
 * The `effective_frequency_days` field resolves the manual override when set
 * and falls back to the auto-calculated value; callers should display it and
 * label the source using `contact_frequency_days`.
 *
 * @throws {CustomerNotFoundError} when no row exists for `customerId`.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  try {
    const [statsResult, contactsResult, addressesResult] = await Promise.all([
      db.execute(customerDetailQuery(customerId)),
      db.execute(customerContactsQuery(customerId)),
      db.execute(customerAddressesQuery(customerId)),
    ])
    const statsRow = (statsResult as unknown as CustomerDetailStatsRow[])[0]
    if (!statsRow) throw new CustomerNotFoundError(customerId)
    return assembleCustomerDetail(
      statsRow,
      contactsResult as unknown as CustomerContactRow[],
      addressesResult as unknown as CustomerAddressOption[],
    )
  } catch (cause) {
    if (cause instanceof CustomerNotFoundError) throw cause
    console.error('getCustomerDetail: query failed', {
      operation: 'getCustomerDetail',
      customerId,
      cause,
    })
    throw new DatabaseError('getCustomerDetail', 'Failed to load customer detail', { cause })
  }
}
