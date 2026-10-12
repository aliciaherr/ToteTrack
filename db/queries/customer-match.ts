import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { parameterFreeCause } from '@/lib/loggable-failure'
import {
  ADDRESS_SIMILARITY_MIN,
  NAME_IN_ADDRESS_SIMILARITY_MIN,
  NAME_SIMILARITY_MIN,
} from '@/lib/matching/matching.constants'
import type { CustomerStatus } from '@/lib/matching/types'

/**
 * Candidate customers for one PO (Feature 16, Task 102). Normalisation and
 * scoring both run in Postgres through migration 0020's functions, so the PO's
 * text and each stored name pass through the same definition.
 */
export interface CandidateRow {
  customerId: string
  status: CustomerStatus
  /** `pg_trgm` similarity of the normalised names, 0–1. 0 when no name was given. */
  nameScore: number
  /** Best similarity of the ship-to against the customer's saved delivery addresses, 0–1. */
  addressScore: number
  /** Best word similarity of the name inside one of those addresses, 0–1. 0 when no name was given. */
  nameInAddressScore: number
  /** The normalised names are equal. */
  exactName: boolean
}

interface RawRow {
  customer_id: unknown
  status: unknown
  name_score: unknown
  address_score: unknown
  name_in_address_score: unknown
  exact_name: unknown
}

/** A row read back as a `CandidateRow`, each column checked rather than trusted. */
function toCandidate(row: RawRow): CandidateRow {
  const score = (value: unknown, column: string): number => {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
    throw new DatabaseError('findCustomerCandidates', `${column} read back as ${String(value)}; expected 0–1`)
  }
  if (typeof row.customer_id !== 'string') {
    throw new DatabaseError('findCustomerCandidates', `customer_id read back as ${String(row.customer_id)}`)
  }
  if (row.status !== 'active' && row.status !== 'inactive') {
    throw new DatabaseError('findCustomerCandidates', `status read back as ${String(row.status)}`)
  }
  return {
    customerId: row.customer_id,
    status: row.status,
    nameScore: score(row.name_score, 'name_score'),
    addressScore: score(row.address_score, 'address_score'),
    nameInAddressScore: score(row.name_in_address_score, 'name_in_address_score'),
    exactName: row.exact_name === true,
  }
}

/**
 * Every customer whose normalised name is at least `NAME_SIMILARITY_MIN`
 * similar to `name` (or equal to it), plus every customer with a saved
 * delivery address at least `ADDRESS_SIMILARITY_MIN` similar to `shipTo`, plus
 * every customer with a saved address containing `name` at word similarity
 * `NAME_IN_ADDRESS_SIMILARITY_MIN` or more (addresses open with the legal name).
 * Unordered and uncapped: ranking is `matchCustomer`'s job.
 *
 * An input that normalises to nothing (e.g. just "Inc.") matches nothing,
 * so it cannot equal a stored name that also normalises to nothing.
 *
 * @param name The customer name on the PO, as extracted. `null` skips the name signal.
 * @param shipTo The ship-to address on the PO. `null` skips the address signal.
 * @returns One row per candidate customer.
 * @throws {DatabaseError} when the query fails, or a row reads back malformed.
 *   Never names the inputs: they are document text (SEC-05).
 */
export async function findCustomerCandidates(name: string | null, shipTo: string | null): Promise<CandidateRow[]> {
  let rows: RawRow[]
  try {
    rows = (await db.execute(sql`
      WITH input AS (
        SELECT NULLIF(public.normalise_company_name(${name}::text), '') AS name,
               NULLIF(public.normalise_address(${shipTo}::text), '') AS ship_to
      ),
      scored AS (
        SELECT c.id, c.status,
               COALESCE(extensions.similarity(public.normalise_company_name(c.company_name), i.name), 0) AS name_score,
               COALESCE(public.normalise_company_name(c.company_name) = i.name, false) AS exact_name,
               COALESCE(addr.address_score, 0) AS address_score,
               COALESCE(addr.name_in_address_score, 0) AS name_in_address_score
        FROM customers c CROSS JOIN input i
        LEFT JOIN LATERAL (
          SELECT max(extensions.similarity(public.normalise_address(a.address), i.ship_to)) AS address_score,
                 max(extensions.word_similarity(i.name, public.normalise_address(a.address))) AS name_in_address_score
          FROM customer_addresses a WHERE a.customer_id = c.id
        ) addr ON true
      )
      SELECT id AS customer_id, status::text AS status, name_score, address_score, name_in_address_score, exact_name
      FROM scored
      WHERE exact_name
         OR name_score >= ${NAME_SIMILARITY_MIN}
         OR address_score >= ${ADDRESS_SIMILARITY_MIN}
         OR name_in_address_score >= ${NAME_IN_ADDRESS_SIMILARITY_MIN}
    `)) as unknown as RawRow[]
  } catch (error) {
    const cause = parameterFreeCause(error)
    console.error('findCustomerCandidates: query failed', { operation: 'findCustomerCandidates', cause })
    throw new DatabaseError('findCustomerCandidates', 'Failed to score customers against a PO', { cause })
  }
  return rows.map(toCandidate)
}
