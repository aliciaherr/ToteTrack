import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError, TicketNotFoundError } from '@/lib/errors'

export type SupportCategory = 'bug' | 'feature_request' | 'question' | 'other'
export type SupportPriority = 'low' | 'standard' | 'high' | 'critical'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface TicketListRow {
  id: string
  title: string
  category: SupportCategory
  priority: SupportPriority
  status: TicketStatus
  created_at: string
}

export interface TicketAttachment {
  id: string
  file_name: string
}

export interface TicketDetail {
  id: string
  title: string
  category: SupportCategory
  priority: SupportPriority
  description: string
  status: TicketStatus
  developer_notes: string | null
  created_at: string
  attachments: TicketAttachment[]
}

interface TicketDetailHeaderRow {
  id: string
  title: string
  category: SupportCategory
  priority: SupportPriority
  description: string
  status: TicketStatus
  developer_notes: string | null
  created_at: string
}

function buildTicketsQuery(): SQL {
  return sql`
    SELECT
      t.id,
      t.title,
      t.category,
      t.priority,
      t.status,
      t.created_at
    FROM support_tickets t
    ORDER BY t.created_at DESC
  `
}

function buildTicketDetailQuery(ticketId: string): SQL {
  return sql`
    SELECT
      t.id,
      t.title,
      t.category,
      t.priority,
      t.description,
      t.status,
      t.developer_notes,
      t.created_at
    FROM support_tickets t
    WHERE t.id = ${ticketId}
    LIMIT 1
  `
}

function buildTicketAttachmentsQuery(ticketId: string): SQL {
  // SELECT only the columns the client actually uses. `file_url` stays
  // server-side — `getSupportAttachmentSignedUrl` re-reads it by id when
  // signing. Keeping raw storage paths off the client payload honours the
  // CONSTRAINT-06 promise as defense-in-depth (security LOW-01 fix).
  return sql`
    SELECT
      a.id,
      a.file_name
    FROM support_attachments a
    WHERE a.ticket_id = ${ticketId}
    ORDER BY a.created_at ASC
  `
}

/**
 * Returns every support ticket for the list view, sorted newest-first.
 * No filter parameters — the plan's Task 27 spec is a flat list; filtering
 * lands later if/when the salesperson backlog warrants it.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getTickets(): Promise<TicketListRow[]> {
  try {
    const result = await db.execute(buildTicketsQuery())
    return result as unknown as TicketListRow[]
  } catch (cause) {
    console.error('getTickets: query failed', { operation: 'getTickets', cause })
    throw new DatabaseError('getTickets', 'Failed to load tickets', { cause })
  }
}

/**
 * Loads a single ticket plus every attached file row. Header and attachments
 * are fetched in parallel so the detail panel renders on a single round-trip.
 *
 * @throws {TicketNotFoundError} when no row matches `ticketId`.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getTicketDetail(ticketId: string): Promise<TicketDetail> {
  try {
    const [headerResult, attachmentsResult] = await Promise.all([
      db.execute(buildTicketDetailQuery(ticketId)),
      db.execute(buildTicketAttachmentsQuery(ticketId)),
    ])
    const row = (headerResult as unknown as TicketDetailHeaderRow[])[0]
    if (!row) throw new TicketNotFoundError(ticketId)
    return { ...row, attachments: attachmentsResult as unknown as TicketAttachment[] }
  } catch (cause) {
    if (cause instanceof TicketNotFoundError) throw cause
    console.error('getTicketDetail: query failed', {
      operation: 'getTicketDetail',
      ticketId,
      cause,
    })
    throw new DatabaseError('getTicketDetail', 'Failed to load ticket detail', { cause })
  }
}
