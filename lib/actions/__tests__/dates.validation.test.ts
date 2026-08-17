import { describe, it, expect } from 'vitest'
import { calendarDateSchema, productionDateSchema } from '../dates.validation'

// Reference days, verified: Fri 2026-05-22 | Sat 2026-05-23 | Sun 2026-05-24 |
// Mon 2026-05-25. `productionDateSchema` is the single write boundary for the
// no-Sunday invariant (CONSTRAINT-19), so it is worth pinning directly rather
// than only through the actions that consume it.
const FRIDAY = '2026-05-22'
const SATURDAY = '2026-05-23'
const SUNDAY = '2026-05-24'
const MONDAY = '2026-05-25'

const SUNDAY_MESSAGE = 'Production dates must fall on Monday through Saturday.'

describe('productionDateSchema', () => {
  it.each([MONDAY, FRIDAY])('accepts the weekday %s', (day) => {
    expect(productionDateSchema.safeParse(day).success).toBe(true)
  })

  it('accepts a Saturday — a full production day since Task 88', () => {
    expect(productionDateSchema.safeParse(SATURDAY).success).toBe(true)
  })

  it('rejects a Sunday, naming Saturday as the last day it allows', () => {
    const result = productionDateSchema.safeParse(SUNDAY)

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(SUNDAY_MESSAGE)
  })

  it('rejects a well-shaped but impossible calendar day before reaching the day check', () => {
    const result = productionDateSchema.safeParse('2026-02-31')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Invalid date format.')
  })

  it('rejects a value that is not bare yyyy-MM-dd', () => {
    expect(productionDateSchema.safeParse('2026-05-25T00:00:00Z').success).toBe(false)
    expect(productionDateSchema.safeParse('05/25/2026').success).toBe(false)
  })
})

describe('calendarDateSchema', () => {
  it('accepts a Sunday — pickups carry no production-day rule (CONSTRAINT-25)', () => {
    expect(calendarDateSchema.safeParse(SUNDAY).success).toBe(true)
  })

  it('still rejects an impossible calendar day', () => {
    expect(calendarDateSchema.safeParse('2026-02-31').success).toBe(false)
  })
})
