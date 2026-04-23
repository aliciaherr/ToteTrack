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

describe('getCustomerDetail', () => {
  it('returns the assembled detail with contacts when the customer exists', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailStatsRow])
      .mockResolvedValueOnce([sampleContactRow])

    const result = await getCustomerDetail(CUSTOMER_ID)

    expect(result.id).toBe(CUSTOMER_ID)
    expect(result.company_name).toBe('Acme Industrial')
    expect(result.contacts).toEqual([sampleContactRow])
    expect(result.effective_frequency_days).toBe(14) // auto when no override
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('prefers the manual override over the auto-calculated frequency', async () => {
    mockExecute
      .mockResolvedValueOnce([{ ...sampleDetailStatsRow, contact_frequency_days: 21 }])
      .mockResolvedValueOnce([])
    const result = await getCustomerDetail(CUSTOMER_ID)
    expect(result.effective_frequency_days).toBe(21)
  })

  it('throws CustomerNotFoundError when the stats query returns no rows', async () => {
    mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([])
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
    mockExecute.mockRejectedValueOnce(driverError).mockRejectedValueOnce(driverError)
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
  container_size: '275' as const,
  container_type: 'rebottled' as const,
  quantity: 10,
  price: '250.00',
  requested_delivery_date: '2026-04-01',
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
  it('returns all zeros for a customer with no completed orders', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result).toEqual({
      gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
      gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
    })
  })

  it('averages across completed orders and fills other buckets with zero', async () => {
    // Simulates 3 completed 275-gallon rebottled orders (qty 10, 20, 15 → avg 15).
    mockExecute.mockResolvedValueOnce([
      { container_size: '275', container_type: 'rebottled', avg_quantity: '15' },
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
      { container_size: '275', container_type: 'rebottled', avg_quantity: '5' },
      { container_size: '275', container_type: 'reconditioned', avg_quantity: '3' },
      { container_size: '275', container_type: 'brand_new', avg_quantity: '2' },
      { container_size: '330', container_type: 'rebottled', avg_quantity: '8' },
    ])
    const result = await getCustomerVolumeOverview(CUSTOMER_ID)
    expect(result.gal275.totalAvg).toBe(10)
    expect(result.gal330.totalAvg).toBe(8)
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
      { id: '11111111-1111-1111-1111-111111111111', company_name: 'Acme' },
      { id: '22222222-2222-2222-2222-222222222222', company_name: 'Beta' },
    ]
    mockExecute.mockResolvedValueOnce(rows)
    const result = await getActiveCustomersForSelect()
    expect(result).toEqual(rows)
    const { sql } = compileLastCall()
    expect(sql).toMatch(/status = 'active'/i)
    expect(sql).toMatch(/order by company_name asc/i)
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
