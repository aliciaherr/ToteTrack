import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError, LeadNotFoundError } from '@/lib/errors'

export type LeadStatus = 'hot' | 'warm' | 'cold' | 'converted'
export type LeadListStatus = 'hot' | 'warm' | 'cold' | 'all'

export interface LeadListRow {
  id: string
  name: string
  company: string | null
  status: LeadStatus
  next_follow_up_date: string | null
}

export interface GetLeadsFilters {
  status?: LeadListStatus
  search?: string
}

export interface LeadDetail {
  id: string
  name: string
  title: string | null
  company: string | null
  email: string | null
  phone: string | null
  status: LeadStatus
  lead_source: string | null
  next_follow_up_date: string | null
  next_action_type: string | null
  updated_at: string
}

export interface LeadNote {
  id: string
  content: string
  created_at: string
}

// 'converted' leads are never surfaced in the list — they become customers.
// Status clause is appended only when a specific status is requested.
function buildStatusClause(status: LeadListStatus): SQL {
  if (status === 'all') return sql``
  return sql`AND l.status = ${status}`
}

// Search clause: case-insensitive contains on name or company. Skipped when
// there is no search term so the base query has no unnecessary WHERE branch.
function buildSearchClause(search: string | undefined): SQL {
  const term = search?.trim()
  if (!term) return sql``
  const pattern = `%${term}%`
  return sql`AND (l.name ILIKE ${pattern} OR l.company ILIKE ${pattern})`
}

function buildLeadsQuery(status: LeadListStatus, search: string | undefined): SQL {
  return sql`
    SELECT
      l.id,
      l.name,
      l.company,
      l.status,
      l.next_follow_up_date
    FROM leads l
    WHERE l.status != 'converted'
    ${buildStatusClause(status)}
    ${buildSearchClause(search)}
    ORDER BY l.next_follow_up_date ASC NULLS LAST
  `
}

function buildLeadDetailQuery(leadId: string): SQL {
  return sql`
    SELECT
      l.id, l.name, l.title, l.company,
      l.email, l.phone, l.status, l.lead_source,
      l.next_follow_up_date, l.next_action_type,
      l.updated_at
    FROM leads l
    WHERE l.id = ${leadId}
    LIMIT 1
  `
}

function buildLeadNotesQuery(leadId: string): SQL {
  return sql`
    SELECT id, content, created_at
    FROM lead_notes
    WHERE lead_id = ${leadId}
    ORDER BY created_at ASC
  `
}

/**
 * Loads the full lead record for the detail panel.
 * @throws {LeadNotFoundError} when no row matches `leadId`.
 * @throws {DatabaseError} when the underlying query fails.
 */
export async function getLeadDetail(leadId: string): Promise<LeadDetail> {
  try {
    const result = await db.execute(buildLeadDetailQuery(leadId))
    const row = (result as unknown as LeadDetail[])[0]
    if (!row) throw new LeadNotFoundError(leadId)
    return row
  } catch (cause) {
    if (cause instanceof LeadNotFoundError) throw cause
    console.error('getLeadDetail: query failed', { leadId, cause })
    throw new DatabaseError('getLeadDetail', 'Failed to load lead detail', { cause })
  }
}

/**
 * Returns all notes for a lead in chronological order (oldest first).
 * @throws {DatabaseError} when the underlying query fails.
 */
export async function getLeadNotes(leadId: string): Promise<LeadNote[]> {
  try {
    const result = await db.execute(buildLeadNotesQuery(leadId))
    return result as unknown as LeadNote[]
  } catch (cause) {
    console.error('getLeadNotes: query failed', { leadId, cause })
    throw new DatabaseError('getLeadNotes', 'Failed to load lead notes', { cause })
  }
}

/**
 * Returns all non-converted leads, optionally filtered by status and/or a
 * case-insensitive search on name or company. Sorted next_follow_up_date ASC,
 * nulls last (leads with upcoming follow-ups first; no-date leads at the end).
 *
 * @throws {DatabaseError} when the underlying query fails.
 */
export async function getLeads(filters?: GetLeadsFilters): Promise<LeadListRow[]> {
  const status = filters?.status ?? 'all'
  const search = filters?.search

  try {
    const result = await db.execute(buildLeadsQuery(status, search))
    return result as unknown as LeadListRow[]
  } catch (cause) {
    throw new DatabaseError('getLeads', 'Failed to load leads', { cause })
  }
}
