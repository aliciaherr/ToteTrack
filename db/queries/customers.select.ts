import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'

export interface CustomerSelectOption {
  id: string
  company_name: string
  default_delivery_address: string | null
}

/**
 * Loads the active customers list in alphabetical order for the order form's
 * customer dropdown. Includes `default_delivery_address` so the order form can
 * auto-populate the delivery address when a customer is picked, without a
 * second round-trip. Inactive customers are excluded; new orders always
 * attach to active accounts.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getActiveCustomersForSelect(): Promise<CustomerSelectOption[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, company_name, default_delivery_address
      FROM customers
      WHERE status = 'active'
      ORDER BY company_name ASC
    `)
    return result as unknown as CustomerSelectOption[]
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
