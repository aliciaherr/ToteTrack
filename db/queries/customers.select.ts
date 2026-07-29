import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'

export interface CustomerAddressOption {
  id: string
  address: string
}

export interface CustomerSelectOption {
  id: string
  company_name: string
  addresses: CustomerAddressOption[]
}

/** Raw row shape before `addresses` normalization — the driver parses json
 * columns to values, but a mocked/edge driver may hand back a string. */
interface RawCustomerSelectRow extends Omit<CustomerSelectOption, 'addresses'> {
  addresses: CustomerAddressOption[] | string | null
}

function parseAddresses(raw: RawCustomerSelectRow['addresses']): CustomerAddressOption[] {
  if (raw == null) return []
  return typeof raw === 'string' ? (JSON.parse(raw) as CustomerAddressOption[]) : raw
}

/**
 * Loads the active customers list in alphabetical order for the order form's
 * customer dropdown. Each customer carries its saved delivery `addresses`
 * (Feature 14), aggregated in one round-trip and ordered most-recently-used
 * first (`last_used_at DESC NULLS LAST, created_at DESC`); customers with no
 * saved addresses get `[]`. Inactive customers are excluded; new orders
 * always attach to active accounts. (`default_delivery_address` left this
 * SELECT in Task 72 with `useDeliveryAddressAutofill`, its last consumer.)
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getActiveCustomersForSelect(): Promise<CustomerSelectOption[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        c.id,
        c.company_name,
        COALESCE((
          SELECT json_agg(
            json_build_object('id', a.id, 'address', a.address)
            ORDER BY a.last_used_at DESC NULLS LAST, a.created_at DESC
          )
          FROM customer_addresses a
          WHERE a.customer_id = c.id
        ), '[]'::json) AS addresses
      FROM customers c
      WHERE c.status = 'active'
      ORDER BY c.company_name ASC
    `)
    const rows = result as unknown as RawCustomerSelectRow[]
    return rows.map((row) => ({ ...row, addresses: parseAddresses(row.addresses) }))
  } catch (cause) {
    console.error('getActiveCustomersForSelect: query failed', {
      operation: 'getActiveCustomersForSelect',
      cause,
    })
    throw new DatabaseError(
      'getActiveCustomersForSelect',
      'Failed to load customers for selection',
      { cause },
    )
  }
}
