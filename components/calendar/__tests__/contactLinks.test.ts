import { describe, it, expect } from 'vitest'
import { hasAnyChannel, isPresent, mailtoHref, telHref } from '../contactLinks'
import type { CalendarContact } from '@/db/queries/calendar'

function makeContact(overrides: Partial<CalendarContact> = {}): CalendarContact {
  return {
    id: 'contact-1',
    name: 'Dana Reyes',
    email: 'dana@acme-industrial.test',
    phone: '(555) 010-2030',
    ...overrides,
  }
}

describe('isPresent', () => {
  it('accepts a value with content', () => {
    expect(isPresent('dana@acme-industrial.test')).toBe(true)
  })

  it('rejects null, empty and whitespace-only', () => {
    expect(isPresent(null)).toBe(false)
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent('')).toBe(false)
    expect(isPresent('   ')).toBe(false)
  })
})

describe('telHref', () => {
  it('strips formatting down to dialable digits', () => {
    expect(telHref('(555) 010-2030')).toBe('sms:5550102030')
  })

  it('keeps a single leading + for an international number', () => {
    expect(telHref('+44 20 7946 0958')).toBe('sms:+442079460958')
  })

  it('drops an extension suffix rather than folding its digits in', () => {
    // `ext`, `ext.` and a bare `x` all appear in hand-entered phone fields.
    expect(telHref('555-010-2030 ext 12')).toBe('sms:5550102030')
    expect(telHref('555-010-2030 ext. 12')).toBe('sms:5550102030')
    expect(telHref('555-010-2030 x99')).toBe('sms:5550102030')
    expect(telHref('555-010-2030 EXT 12')).toBe('sms:5550102030')
  })

  it('yields an empty target for a phone with nothing dialable in it', () => {
    // Error case: the field held free text, not a number. Callers gate on
    // `isPresent` first, so this never reaches a rendered link — but it must
    // not produce `sms:undefined` or throw.
    expect(telHref('   ')).toBe('sms:')
    expect(telHref('call the yard')).toBe('sms:')
  })
})

describe('mailtoHref', () => {
  it('builds a mailto for a trimmed address', () => {
    expect(mailtoHref('  dana@acme-industrial.test  ')).toBe(
      'mailto:dana@acme-industrial.test',
    )
  })

  it('percent-encodes the local part but leaves the domain alone', () => {
    expect(mailtoHref('dana+orders@acme-industrial.test')).toBe(
      'mailto:dana%2Borders@acme-industrial.test',
    )
  })

  it('splits on the last @ so a quoted local part survives', () => {
    expect(mailtoHref('"a@b"@acme.test')).toBe('mailto:%22a%40b%22@acme.test')
  })

  it('encodes the whole thing when there is no @ at all', () => {
    // Error case: junk in the email column must not emit mailto syntax.
    expect(mailtoHref('not an address')).toBe('mailto:not%20an%20address')
  })
})

describe('hasAnyChannel', () => {
  it('is true when one contact has a phone and another has an email', () => {
    expect(
      hasAnyChannel([
        makeContact({ id: 'a', email: null }),
        makeContact({ id: 'b', phone: null }),
      ]),
    ).toBe(true)
  })

  it('is false for an empty contact list', () => {
    expect(hasAnyChannel([])).toBe(false)
  })

  it('is false when every contact is whitespace-only on both channels', () => {
    expect(
      hasAnyChannel([
        makeContact({ id: 'a', email: '   ', phone: '' }),
        makeContact({ id: 'b', email: null, phone: null }),
      ]),
    ).toBe(false)
  })
})
