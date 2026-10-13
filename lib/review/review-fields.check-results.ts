import { z } from 'zod'
import type { QuoteStatus } from '@/lib/checks/types'

/**
 * Reads `inbound_pos.check_results` for the review pane (Task 107). The column
 * is free-form `jsonb` written by several stages, so every part is narrowed
 * here and a malformed part reads as empty rather than breaking the pane.
 */

const failureSchema = z.object({ check: z.string(), field: z.string(), detail: z.string() })
const quoteSchema = z.object({ field: z.string(), status: z.enum(['verified', 'not_found', 'unverifiable']) })
const candidateSchema = z.object({
  customerId: z.string(),
  addressMatched: z.boolean(),
})
const customerMatchSchema = z.object({
  prefillCustomerId: z.string().nullable(),
  candidates: z.array(candidateSchema),
})

export interface StoredFailure {
  check: string
  field: string
  detail: string
}

export interface StoredCheckResults {
  /** Check failures only: `ingest_limit` entries belong to the refusal card (Task 106). */
  failures: StoredFailure[]
  quotes: { field: string; status: QuoteStatus }[]
  customerMatch: z.infer<typeof customerMatchSchema> | null
}

function arrayOf<T>(value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = schema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * @param value `inbound_pos.check_results`, any shape.
 * @returns Its failures, quote statuses and customer match; each empty or
 *   `null` when absent or malformed.
 */
export function storedCheckResultsOf(value: unknown): StoredCheckResults {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const match = customerMatchSchema.safeParse(record.customerMatch)
  return {
    failures: arrayOf(record.failures, failureSchema).filter((failure) => failure.check !== 'ingest_limit'),
    quotes: arrayOf(record.quotes, quoteSchema),
    customerMatch: match.success ? match.data : null,
  }
}
