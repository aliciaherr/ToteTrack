import { describe, it, expect } from 'vitest'
import type { FieldFlag } from '@/lib/review/review-fields.types'
import { fieldStatus, isGroupEdited, missingFieldLines, orderFlags } from '../reviewPane.helpers'
import { reviewFields } from './reviewFields.fixture'

const flag = (field: FieldFlag['field'], kind: FieldFlag['kind']): FieldFlag => ({ field, kind, message: kind, detail: '' })
const loaded = reviewFields().values

describe('orderFlags', () => {
  it('lists failures before choices, keeping order within each group', () => {
    const flags = [
      flag('customer_id', 'ambiguous_customer'),
      flag('totals', 'total_mismatch'),
      flag('po_number', 'missing_po_number'),
      flag('general', 'extraction_failed'),
    ]
    expect(orderFlags(flags).map((entry) => entry.kind)).toEqual([
      'total_mismatch',
      'extraction_failed',
      'ambiguous_customer',
      'missing_po_number',
    ])
  })

  it('returns an empty list for no flags', () => {
    expect(orderFlags([])).toEqual([])
  })
})

describe('missingFieldLines', () => {
  it('lists every required field the reading left empty', () => {
    expect(missingFieldLines(loaded, [])).toEqual([
      'Customer not chosen: choose one',
      'Delivery address not found: enter it',
      'Delivery date not found: enter it',
    ])
  })

  it('does not repeat a field that already has a flag', () => {
    const flags = [flag('customer_id', 'ambiguous_customer'), flag('delivery_address', 'missing_ship_to')]
    expect(missingFieldLines(loaded, flags)).toEqual(['Delivery date not found: enter it'])
  })

  it('folds empty quantities into a no-tote-lines flag', () => {
    const empty = { ...loaded, qty_275_recon: 0 }
    expect(missingFieldLines(empty, [])).toContain('Quantities not found: enter them')
    expect(missingFieldLines(empty, [flag('general', 'no_tote_lines')])).not.toContain('Quantities not found: enter them')
  })

  it('skips the address when the customer collects', () => {
    expect(missingFieldLines({ ...loaded, customer_collects: true }, [])).not.toContain('Delivery address not found: enter it')
  })
})

describe('fieldStatus', () => {
  it('is confident when filled and unflagged', () => {
    expect(fieldStatus('po_number', loaded, [], false)).toBe('confident')
    expect(fieldStatus('quantities', loaded, [], false)).toBe('confident')
  })

  it('needs attention when empty or flagged', () => {
    expect(fieldStatus('customer_id', loaded, [], false)).toBe('attention')
    expect(fieldStatus('po_number', loaded, [flag('po_number', 'value_too_long')], false)).toBe('attention')
    expect(fieldStatus('quantities', loaded, [flag('totals', 'total_mismatch')], false)).toBe('attention')
  })

  it('is neutral once edited, whatever else holds', () => {
    expect(fieldStatus('customer_id', loaded, [flag('customer_id', 'ambiguous_customer')], true)).toBe('neutral')
  })
})

describe('isGroupEdited', () => {
  it('is false for the loaded values and true after a change in the group', () => {
    expect(isGroupEdited('quantities', loaded, loaded)).toBe(false)
    expect(isGroupEdited('quantities', { ...loaded, unit_price_330_new: '9.00' }, loaded)).toBe(true)
  })

  it('ignores changes outside the group', () => {
    expect(isGroupEdited('po_number', { ...loaded, notes: 'call first' }, loaded)).toBe(false)
  })
})
