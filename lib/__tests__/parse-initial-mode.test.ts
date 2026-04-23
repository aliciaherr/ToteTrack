import { describe, it, expect } from 'vitest'
import { parseInitialMode } from '../parse-initial-mode'

describe('parseInitialMode', () => {
  it('returns the openMode when value is "1"', () => {
    expect(parseInitialMode('1', 'new-customer')).toBe('new-customer')
    expect(parseInitialMode('1', 'new-order')).toBe('new-order')
    expect(parseInitialMode('1', 'new-lead')).toBe('new-lead')
  })

  it('returns "detail" when value is undefined', () => {
    expect(parseInitialMode(undefined, 'new-customer')).toBe('detail')
  })

  it('returns "detail" for any value other than "1"', () => {
    expect(parseInitialMode('0', 'new-customer')).toBe('detail')
    expect(parseInitialMode('true', 'new-customer')).toBe('detail')
    expect(parseInitialMode('', 'new-customer')).toBe('detail')
    expect(parseInitialMode('11', 'new-customer')).toBe('detail')
  })
})
