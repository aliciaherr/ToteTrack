import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { format, subDays, startOfYear } from 'date-fns'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import {
  getCustomers,
  getCustomerDetail,
  getCustomerOrders,
  getCustomerVolumeOverview,
  getActiveCustomersForSelect,
  computeWindowStartDate,
} from '../customers'
import { CustomerNotFoundError, DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
}

function compileLastCall(): { sql: string; params: unknown[] } {
  return compileCall(0)
}

const sampleListRow = {
  id: '11111111-1111-1111-1111-111111111111',
  company_name: 'Acme Industrial',
  status: 'active' as const,
  primary_contact_name: 'Jane Doe',
  primary_contact_role: 'Operations Manager',
  last_completed_date: '2026-04-01',
  completed_order_count: 7,
  overdue_days: 5,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCustomers', () => {
  it('returns rows from the database when no filters are provided', async () => {
    mockExecute.mockResolvedValueOnce([sampleListRow])
    const result = await getCustomers()
    expect(result).toEqual([sampleListRow])
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('passes status=inactive to the query when inactive is requested', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomers({ status: 'inactive' })
    const { params } = compileLastCall()
    expect(params).toContain('inactive')
    expect(params).not.toContain('active')
  })

  it('emits a case-insensitive ILIKE clause when a search term is provided', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomers({ search: 'acme' })
    const { sql: compiled, params } = compileLastCall()
    expect(compiled).toMatch(/ILIKE/)
    expect(params).toContain('%acme%')
  })

  it('omits the ILIKE clause when the search term is whitespace-only', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomers({ search: '   ' })
    const { sql: compiled } = compileLastCall()
    expect(compiled).not.toMatch(/ILIKE/)
  })

  it('suppresses overdue_days for customers with a scheduled order (Task 74)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomers()
    const { sql: compiled } = compileLastCall()
    expect(compiled).toMatch(/bool_or\(o\.status\s*=\s*'scheduled'\)\s+AS\s+has_scheduled_order/i)
    expect(compiled).toMatch(/CASE\s+WHEN os\.has_scheduled_order THEN NULL/i)
  })

  it('orders by completed_order_count DESC when sort=order_count', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomers({ sort: 'order_count' })
    const { sql: compiled } = compileLastCall()
    expect(compiled).toMatch(/completed_order_count DESC/)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomers()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getCustomers',
      cause: driverError,
    })
  })
})

const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'

const sampleDetailStatsRow = {
  id: CUSTOMER_ID,
  company_name: 'Acme Industrial',
  status: 'active' as const,
  contact_frequency_days: null,
  notes: null,
  completed_order_count: 4,
  last_completed_date: '2026-04-10',
  auto_calculated_frequency_days: 14,
  overdue_days: -4,
}

const sampleContactRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Jane Doe',
  role: 'Operations Manager',
  email: 'jane@acme.example',
  phone: '555-0100',
  is_primary: true,
}

const sampleAddressRows = [
  { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', address: 'Used yesterday' },
  { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', address: 'Never used, newest' },
]

describe('getCustomerDetail', () => {
  it('returns the assembled detail with contacts and MRU-first addresses when the customer exists', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailStatsRow])
      .mockResolvedValueOnce([sampleContactRow])
      .mockResolvedValueOnce(sampleAddressRows)

    const result = await getCustomerDetail(CUSTOMER_ID)

    expect(result.id).toBe(CUSTOMER_ID)
    expect(result.company_name).toBe('Acme Industrial')
    expect(result.contacts).toEqual([sampleContactRow])
    expect(result.addresses).toEqual(sampleAddressRows)
    expect(result.effective_frequency_days).toBe(14) // auto when no override
    expect(mockExecute).toHaveBeenCalledTimes(3)
  })

  it('compiles an MRU-first addresses query and no longer selects the deprecated column', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailStatsRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await getCustomerDetail(CUSTOMER_ID)

    const detailQuery = compileCall(0)
    expect(detailQuery.sql, 'deprecated column must not be selected').not.toMatch(
      /default_delivery_address/,
    )
    expect(detailQuery.sql, 'scheduled order suppresses overdue (Task 74)').toMatch(
      /bool_or\(status\s*=\s*'scheduled'\)\s+AS\s+has_scheduled_order/i,
    )
    const addressesQuery = compileCall(2)
    expect(addressesQuery.sql).toMatch(/FROM customer_addresses/)
    expect(addressesQuery.sql, 'MRU-first ordering').toMatch(
      /ORDER BY last_used_at DESC NULLS LAST, created_at DESC/,
    )
    expect(addressesQuery.params).toContain(CUSTOMER_ID)
  })

  it('prefers the manual override over the auto-calculated frequency', async () => {
    mockExecute
      .mockResolvedValueOnce([{ ...sampleDetailStatsRow, contact_frequency_days: 21 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const result = await getCustomerDetail(CUSTOMER_ID)
    expect(result.effective_frequency_days).toBe(21)
  })

  it('throws CustomerNotFoundError when the stats query returns no rows', async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerDetail(CUSTOMER_ID)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(CustomerNotFoundError)
    expect((caught as CustomerNotFoundError).customerId).toBe(CUSTOMER_ID)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute
      .mockRejectedValueOnce(driverError)
      .mockRejectedValueOnce(driverError)
      .mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerDetail(CUSTOMER_ID)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getCustomerDetail',
      cause: driverError,
    })
  })
})

describe('computeWindowStartDate', () => {
  const today = new Date('2026-04-20T12:00:00Z')

  it('1M: returns the date 30 days before today', () => {
    expect(computeWindowStartDate('1M', today)).toBe('2026-03-21')
  })

  it('3M: returns the date 90 days before today', () => {
    expect(computeWindowStartDate('3M', today)).toBe('2026-01-20')
  })

  it('YTD: returns Jan 1 of the current year', () => {
    expect(computeWindowStartDate('YTD', today)).toBe('2026-01-01')
  })
})

const sampleOrderRow = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  po_number: 'PO-1001',
  status: 'completed' as const,
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '250.00',
  requested_delivery_date: '2026-04-01',
  backhaul: false,
}

describe('getCustomerOrders', () => {
  it('returns rows from the database for the requested customer', async () => {
    mockExecute.mockResolvedValueOnce([sampleOrderRow])
    const result = await getCustomerOrders(CUSTOMER_ID, '3M')
    expect(result).toEqual([sampleOrderRow])
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('1M window: compiles a WHERE that uses a date 30 days before today', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomerOrders(CUSTOMER_ID, '1M')
    const { params } = compileLastCall()
    const expectedStart = format(subDays(new Date(), 30), 'yyyy-MM-dd')
    expect(params).toContain(CUSTOMER_ID)
    expect(params).toContain(expectedStart)
  })

  it('YTD window: compiles a WHERE that uses Jan 1 of the current year', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomerOrders(CUSTOMER_ID, 'YTD')
    const { params } = compileLastCall()
    const expectedStart = format(startOfYear(new Date()), 'yyyy-MM-dd')
    expect(params).toContain(expectedStart)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerOrders(CUSTOMER_ID, '1M')
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getCustomerOrders',
      cause: driverError,
    })
  })
})

describe('getCustomerVolumeOverview', () => {
  it('returns all zeros for a customer with no completed orders (empty result)', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result).toEqual({
      gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
      gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
    })
  })

  it('returns all zeros when row has only NULLs (customer with completed POs but every combo qty = 0 — should not happen in practice but the FILTER clause makes this expressible)', async () => {
    mockExecute.mockResolvedValueOnce([
      {
        avg_275_recon: null, avg_275_rebot: null, avg_275_new: null,
        avg_330_recon: null, avg_330_rebot: null, avg_330_new: null,
      },
    ])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result.gal275.totalAvg).toBe(0)
    expect(result.gal330.totalAvg).toBe(0)
  })

  it('parses string averages and fills NULL combos with zero', async () => {
    // Simulates 3 POs with non-zero 275-rebot quantities (avg 15) and nothing else.
    mockExecute.mockResolvedValueOnce([
      {
        avg_275_recon: null,
        avg_275_rebot: '15',
        avg_275_new: null,
        avg_330_recon: null,
        avg_330_rebot: null,
        avg_330_new: null,
      },
    ])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result.gal275).toEqual({
      rebottled: 15,
      reconditioned: 0,
      brandNew: 0,
      totalAvg: 15,
    })
    expect(result.gal330).toEqual({
      rebottled: 0,
      reconditioned: 0,
      brandNew: 0,
      totalAvg: 0,
    })
  })

  it('sums the three type averages into totalAvg for each size', async () => {
    mockExecute.mockResolvedValueOnce([
      {
        avg_275_recon: '3',
        avg_275_rebot: '5',
        avg_275_new: '2',
        avg_330_recon: null,
        avg_330_rebot: '8',
        avg_330_new: null,
      },
    ])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result.gal275.totalAvg).toBe(10)
    expect(result.gal330.totalAvg).toBe(8)
  })

  it('emits a single-row aggregate query with FILTER per qty column (Feature 9)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomerVolumeOverview(CUSTOMER_ID)
    const { sql } = compileLastCall()
    for (const col of [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
    ]) {
      expect(sql, `expected AVG(${col}) and FILTER (WHERE ${col} > 0)`).toMatch(
        new RegExp(`AVG\\(${col}\\)[\\s\\S]*FILTER \\(WHERE ${col} > 0\\)`)
      )
    }
    expect(sql).toMatch(/status IN \('completed', 'invoiced'\)/)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerVolumeOverview(CUSTOMER_ID)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getCustomerVolumeOverview',
      cause: driverError,
    })
  })
})

describe('getActiveCustomersForSelect', () => {
  it('returns id and company_name for active customers, filtered by status', async () => {
    const rows = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        company_name: 'Acme',
        addresses: [],
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        company_name: 'Beta',
        addresses: [],
      },
    ]
    mockExecute.mockResolvedValueOnce(rows)
    const result = await getActiveCustomersForSelect()
    expect(result).toEqual(rows)
    const { sql } = compileLastCall()
    expect(sql).toMatch(/status = 'active'/i)
    expect(sql).toMatch(/order by c\.company_name asc/i)
  })

  it('returns MRU-ordered addresses per customer and [] for a customer with none', async () => {
    const acmeAddresses = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', address: 'Used yesterday' },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', address: 'Never used, newest' },
    ]
    mockExecute.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-111111111111',
        company_name: 'Acme',
        addresses: acmeAddresses,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        company_name: 'Beta',
        addresses: null, // COALESCE guards this in real SQL; the mapper must too
      },
    ])
    const result = await getActiveCustomersForSelect()
    expect(result[0]?.addresses).toEqual(acmeAddresses)
    expect(result[1]?.addresses).toEqual([])
    const { sql } = compileLastCall()
    expect(sql, 'MRU ordering inside json_agg').toMatch(
      /ORDER BY a\.last_used_at DESC NULLS LAST, a\.created_at DESC/i,
    )
    expect(sql, 'zero-address customers must get []').toMatch(/COALESCE/i)
    expect(sql).toMatch(/'\[\]'::json/)
  })

  it('parses addresses defensively when the driver returns the json column as a string', async () => {
    mockExecute.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-111111111111',
        company_name: 'Acme',
        addresses: '[{"id":"cccccccc-cccc-cccc-cccc-cccccccccccc","address":"Dock 4"}]',
      },
    ])
    const result = await getActiveCustomersForSelect()
    expect(result[0]?.addresses).toEqual([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', address: 'Dock 4' },
    ])
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getActiveCustomersForSelect()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getActiveCustomersForSelect',
      cause: driverError,
    })
  })
})
