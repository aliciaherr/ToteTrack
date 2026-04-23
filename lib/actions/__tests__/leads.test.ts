import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db', () => ({
  db: { insert: mockInsert, update: mockUpdate, select: mockSelect, transaction: mockTransaction },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { addLeadNote, setNextAction, createLead, updateLead, convertLeadToCustomer } from '../leads'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_FAIL = { data: { user: null }, error: new Error('no session') }
const LEAD_ID = '33333333-3333-3333-3333-333333333333'

function stubInsertReturning(id: string) {
  mockInsert.mockReturnValueOnce({
    values: () => ({ returning: () => Promise.resolve([{ id }]) }),
  })
}

function stubUpdateResolves() {
  mockUpdate.mockReturnValueOnce({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addLeadNote', () => {
  it('inserts the note and returns the new id on success', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubInsertReturning('note-uuid-1')
    stubUpdateResolves()
    const result = await addLeadNote(LEAD_ID, 'First note.')
    expect(result).toEqual({ id: 'note-uuid-1' })
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('returns an error when content is empty', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await addLeadNote(LEAD_ID, '')
    expect(result).toEqual({ error: 'Note cannot be empty.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns an error when content is whitespace only', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await addLeadNote(LEAD_ID, '   ')
    expect(result).toEqual({ error: 'Note cannot be empty.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns an error for a malformed lead id', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await addLeadNote('not-a-uuid', 'Note content.')
    expect(result).toEqual({ error: 'Invalid lead id.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await addLeadNote(LEAD_ID, 'Note.')
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns a generic error when the insert rejects', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockInsert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.reject(new Error('db error')) }),
    })
    const result = await addLeadNote(LEAD_ID, 'Note.')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db error/i)
  })
})

describe('setNextAction', () => {
  const VALID_INPUT = { date: '2026-05-20', time: '10:00', actionType: 'call' }

  it('updates next_follow_up_date and next_action_type on success', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubUpdateResolves()
    const result = await setNextAction(LEAD_ID, VALID_INPUT)
    expect(result).toEqual({ success: true })
    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('returns an error for an invalid date format', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await setNextAction(LEAD_ID, { ...VALID_INPUT, date: 'not-a-date' })
    expect(result).toEqual({ error: 'Invalid date format.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns an error for an invalid action type', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await setNextAction(LEAD_ID, { ...VALID_INPUT, actionType: 'smoke_signal' })
    expect(result).toEqual({ error: 'Invalid action type.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns an error for a malformed lead id', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await setNextAction('bad-id', VALID_INPUT)
    expect(result).toEqual({ error: 'Invalid lead id.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await setNextAction(LEAD_ID, VALID_INPUT)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns a generic error when the update rejects', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(new Error('db error')) }),
    })
    const result = await setNextAction(LEAD_ID, VALID_INPUT)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db error/i)
  })
})

// ─── createLead ───────────────────────────────────────────────────────────────

const VALID_LEAD_INPUT = {
  name: 'Alice Smith',
  email: 'alice@example.com',
  phone: null,
  company: 'Acme Corp',
  title: null,
  status: 'warm' as const,
  lead_source: null,
  next_follow_up_date: null,
  next_action_type: null,
}

describe('createLead', () => {
  it('inserts the lead and returns the new id on success', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockInsert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 'lead-uuid-1' }]) }),
    })
    const result = await createLead(VALID_LEAD_INPUT)
    expect(result).toEqual({ id: 'lead-uuid-1' })
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('returns an error when name is empty', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await createLead({ ...VALID_LEAD_INPUT, name: '' })
    expect(result).toEqual({ error: 'Name is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('accepts a lead with no email and no phone (both optional)', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockInsert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 'aaa11111-1111-1111-1111-111111111111' }]) }),
    })
    const result = await createLead({ ...VALID_LEAD_INPUT, email: null, phone: null })
    expect(result).toEqual({ id: 'aaa11111-1111-1111-1111-111111111111' })
    expect(mockInsert).toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await createLead(VALID_LEAD_INPUT)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns a generic error when the insert rejects', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockInsert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.reject(new Error('db down')) }),
    })
    const result = await createLead(VALID_LEAD_INPUT)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db down/i)
  })
})

// ─── updateLead ───────────────────────────────────────────────────────────────

describe('updateLead', () => {
  it('updates the lead and returns success on happy path', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    })
    const result = await updateLead(LEAD_ID, { ...VALID_LEAD_INPUT, status: 'hot' })
    expect(result).toEqual({ success: true })
    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('returns an error for a malformed lead id', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await updateLead('bad-id', VALID_LEAD_INPUT)
    expect(result).toEqual({ error: 'Invalid lead id.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await updateLead(LEAD_ID, VALID_LEAD_INPUT)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ─── convertLeadToCustomer ────────────────────────────────────────────────────

const COMPANY_ID = '22222222-2222-2222-2222-222222222222'

function stubSelectLead(override: Partial<{ name: string; company: string | null; status: string }> = {}) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () =>
        Promise.resolve([
          {
            name: 'Alice Smith',
            company: override.company !== undefined ? override.company : 'Acme Corp',
            email: 'alice@example.com',
            phone: null,
            title: null,
            status: override.status ?? 'warm',
            ...override,
          },
        ]),
    }),
  })
}

function stubNoDuplicateCustomer() {
  mockSelect.mockReturnValueOnce({
    from: () => ({ where: () => Promise.resolve([]) }),
  })
}

function stubDuplicateCustomer(name: string) {
  mockSelect.mockReturnValueOnce({
    from: () => ({ where: () => Promise.resolve([{ company_name: name }]) }),
  })
}

function stubTransactionSuccess(customerId: string) {
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: customerId }]) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    }
    return await fn(tx)
  })
}

describe('convertLeadToCustomer', () => {
  it('creates a customer + sets lead to converted atomically on success', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectLead()
    stubNoDuplicateCustomer()
    stubTransactionSuccess(COMPANY_ID)
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toEqual({ customerId: COMPANY_ID })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('returns a warning when a customer with the same company name exists', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectLead({ company: 'Acme Corp' })
    stubDuplicateCustomer('Acme Corp')
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toHaveProperty('warning')
    expect((result as { warning: string }).warning).toContain('Acme Corp')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('bypasses the duplicate check when force=true and converts successfully', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectLead({ company: 'Acme Corp' })
    // No duplicate-check select called when force=true
    stubTransactionSuccess(COMPANY_ID)
    const result = await convertLeadToCustomer(LEAD_ID, true)
    expect(result).toEqual({ customerId: COMPANY_ID })
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it('returns a generic error and does not update lead when the transaction fails', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectLead({ company: null }) // null company skips duplicate check
    mockTransaction.mockRejectedValueOnce(new Error('insert failed'))
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/insert failed/i)
    // mockUpdate was NOT called outside the transaction — lead status unchanged
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
