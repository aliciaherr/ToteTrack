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

import { leads, customers } from '@/db/schema'
import { addLeadNote, setNextAction, createLead, updateLead, convertLeadToCustomer } from '../leads'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
// A *resolved* response with no user — the session is simply missing. The
// shared guard distinguishes this from an auth-service failure, so this
// fixture must not carry an `error` (EH-02/EH-04).
const AUTH_FAIL = { data: { user: null }, error: null }
// The service itself answered with a failure. Different message, and logged.
const AUTH_SERVICE_DOWN = {
  data: { user: null },
  error: { status: 503, name: 'AuthApiError', message: 'service unavailable' },
}
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
  // `reset`, not `clear`: the conversion suite below installs whole
  // implementations on these mocks, and `clearAllMocks` wipes call history but
  // leaves implementations in place — they would leak into every later test.
  vi.resetAllMocks()
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

  it('returns the generic message when the auth service answers with a failure, not a sign-in prompt', async () => {
    // The service being down is not a missing session — telling the operator
    // to sign in sends them to a login screen that cannot help (EH-02/EH-04).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValueOnce(AUTH_SERVICE_DOWN)
    const result = await createLead(VALID_LEAD_INPUT)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'assertAuthenticated: auth check failed',
      expect.objectContaining({ operation: 'assertAuthenticated', status: 503 }),
    )
    consoleError.mockRestore()
  })

  it('returns a handled error and logs with context when getUser itself rejects', async () => {
    // The guard runs inside the action's try, so a rejecting auth call
    // becomes an { error } result instead of rejecting on the client.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockRejectedValueOnce(new Error('auth service unreachable'))
    const result = await createLead(VALID_LEAD_INPUT)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'createLead: insert failed',
      expect.objectContaining({ cause: expect.any(Error) }),
    )
    consoleError.mockRestore()
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

  it('returns a generic error and revalidates nothing when the transaction fails', async () => {
    // Error *mapping* only — the transaction rejects before its callback runs,
    // so this says nothing about rollback. The state a failed conversion
    // leaves behind is pinned by the rollback suite below.
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectLead({ company: null }) // null company skips duplicate check
    mockTransaction.mockRejectedValueOnce(new Error('insert failed'))
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/insert failed/i)
    // A conversion that did not happen invalidates no cache — the two
    // revalidations sit after the await and must stay there.
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await convertLeadToCustomer(LEAD_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ─── convertLeadToCustomer: the rollback guarantee ────────────────────────────

/**
 * In-memory stand-in for the three tables a conversion touches, in the spirit
 * of `placement.fake-db.ts`: it *applies* the writes rather than queueing
 * return values, so a test can assert the state a failed conversion leaves
 * behind instead of the statements that produced it.
 *
 * The distinction it exists to draw is between writes issued on the `tx`
 * handle and writes issued on `db` itself. Only `tx` writes are held pending
 * and dropped when the transaction fails to commit; a `db` write lands
 * immediately and survives, exactly as a statement outside the transaction
 * would in Postgres. That asymmetry is what makes "the lead is not left
 * converted" a claim about `leads.convert.ts` rather than about the fake:
 * move the status write off `tx` and onto `db` and it stops holding.
 */
interface FakeConversionDb {
  /** The two lead columns a conversion writes. */
  lead(): { status: string; converted_customer_id: string | null }
  customers(): { id: string; company_name: string }[]
  contacts(): { customer_id: string; name: string; is_primary: boolean }[]
  /** `db.update` calls — i.e. writes made outside the transaction handle. */
  writesOutsideTransaction(): number
}

const CONVERTED_CUSTOMER_ID = 'customer-1'

/**
 * Wires the module-level `db` mocks to a fresh in-memory store.
 * @param failCommitWith When given, the transaction throws with this message
 *   *after* its callback has run — the only failure point that lands after the
 *   status write, and therefore the only one that can prove a rollback.
 */
function installConversionDb(failCommitWith?: string): FakeConversionDb {
  const state = {
    lead: {
      name: 'Alice Smith',
      company: 'Acme Corp' as string | null,
      email: 'alice@example.com',
      phone: null as string | null,
      title: null as string | null,
      status: 'warm',
      converted_customer_id: null as string | null,
    },
    customers: [] as { id: string; company_name: string }[],
    contacts: [] as { customer_id: string; name: string; is_primary: boolean }[],
  }
  let outsideWrites = 0

  function applyLeadSet(payload: Record<string, unknown>): void {
    if ('status' in payload) state.lead.status = payload.status as string
    if ('converted_customer_id' in payload) {
      state.lead.converted_customer_id = payload.converted_customer_id as string | null
    }
  }

  // `loadLeadForConversion` reads `leads`; `findDuplicateCustomer` reads
  // `customers`. The table handed to `.from()` is what tells them apart.
  mockSelect.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () =>
        Promise.resolve(
          table === leads
            ? [{ ...state.lead }]
            : state.customers.map((row) => ({ company_name: row.company_name })),
        ),
    }),
  }))

  mockTransaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
    // Writes queue here until commit. Dropping the queue is the rollback.
    const pending: (() => void)[] = []
    const tx = {
      insert: (table: unknown) => ({
        values: (payload: Record<string, unknown>) => {
          if (table === customers) {
            // The id has to exist before commit — the contact insert and the
            // lead update both depend on it.
            pending.push(() =>
              state.customers.push({
                id: CONVERTED_CUSTOMER_ID,
                company_name: payload.company_name as string,
              }),
            )
            return { returning: () => Promise.resolve([{ id: CONVERTED_CUSTOMER_ID }]) }
          }
          pending.push(() =>
            state.contacts.push({
              customer_id: payload.customer_id as string,
              name: payload.name as string,
              is_primary: payload.is_primary as boolean,
            }),
          )
          return Promise.resolve(undefined)
        },
      }),
      update: () => ({
        set: (payload: Record<string, unknown>) => ({
          where: () => {
            pending.push(() => applyLeadSet(payload))
            return Promise.resolve(undefined)
          },
        }),
      }),
    }
    const result = await run(tx)
    if (failCommitWith !== undefined) throw new Error(failCommitWith)
    for (const apply of pending) apply()
    return result
  })

  // The un-transactional path: applied at once, and never rolled back.
  mockUpdate.mockImplementation(() => ({
    set: (payload: Record<string, unknown>) => ({
      where: () => {
        outsideWrites += 1
        applyLeadSet(payload)
        return Promise.resolve(undefined)
      },
    }),
  }))

  return {
    lead: () => ({
      status: state.lead.status,
      converted_customer_id: state.lead.converted_customer_id,
    }),
    customers: () => state.customers,
    contacts: () => state.contacts,
    writesOutsideTransaction: () => outsideWrites,
  }
}

describe('convertLeadToCustomer rollback', () => {
  it('commits the customer, the primary contact and the converted status together', async () => {
    // The companion the rollback test needs: without it, "the lead is still
    // warm" would also hold for code that never writes the status at all.
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const fake = installConversionDb()

    const result = await convertLeadToCustomer(LEAD_ID)

    expect(result).toEqual({ customerId: CONVERTED_CUSTOMER_ID })
    expect(fake.lead()).toEqual({
      status: 'converted',
      converted_customer_id: CONVERTED_CUSTOMER_ID,
    })
    expect(fake.customers()).toEqual([
      { id: CONVERTED_CUSTOMER_ID, company_name: 'Acme Corp' },
    ])
    expect(fake.contacts()).toEqual([
      { customer_id: CONVERTED_CUSTOMER_ID, name: 'Alice Smith', is_primary: true },
    ])
    // Every one of those three writes went through the transaction handle.
    expect(fake.writesOutsideTransaction()).toBe(0)
  })

  it('leaves the lead unconverted and writes nothing when the transaction does not commit', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const fake = installConversionDb('could not serialize access')

    const result = await convertLeadToCustomer(LEAD_ID)

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect((result as { error: string }).error).not.toMatch(/serialize/i)
    // The status write is inside the transaction, so it goes back with it —
    // the salesperson's lead is still workable rather than stranded as
    // 'converted' with no customer behind it.
    expect(fake.lead()).toEqual({ status: 'warm', converted_customer_id: null })
    expect(fake.customers()).toEqual([])
    expect(fake.contacts()).toEqual([])
    // A write outside the transaction is the one way the status could have
    // survived the rollback, so there must not be one.
    expect(fake.writesOutsideTransaction()).toBe(0)
  })
})
