import { describe, it, expect } from 'vitest'
import { hasAnyChannel, isPresent, isReachable, mailtoHref, smsHref } from '../contact-links'

/**
 * The structural shape `isReachable` accepts — deliberately not `CalendarContact`
 * or `CustomerContactRow`, because the module under test is shared and must not
 * know about either feature's DB row.
 */
function makeContact(overrides: Partial<{ email: string | null; phone: string | null }> = {}) {
  return {
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

describe('smsHref', () => {
  it('strips formatting down to dialable digits', () => {
    expect(smsHref('(555) 010-2030')).toBe('sms:5550102030')
  })

  it('keeps a single leading + for an international number', () => {
    expect(smsHref('+1 (555) 010-0100')).toBe('sms:+15550100100')
    expect(smsHref('+44 20 7946 0958')).toBe('sms:+442079460958')
  })

  it('drops an extension suffix rather than folding its digits in', () => {
    // `ext`, `ext.` and a bare `x` all appear in hand-entered phone fields.
    expect(smsHref('555-010-2030 ext 12')).toBe('sms:5550102030')
    expect(smsHref('555-010-2030 ext. 12')).toBe('sms:5550102030')
    expect(smsHref('555-010-2030 x99')).toBe('sms:5550102030')
    expect(smsHref('555-010-2030 EXT 12')).toBe('sms:5550102030')
    // No space in front of the marker: the left anchor is "not a letter", not a
    // word boundary, because there is no boundary between a digit and an `x`.
    expect(smsHref('555-010-2030x99')).toBe('sms:5550102030')
  })

  it('drops an extension that has a note trailing it rather than folding its digits in', () => {
    // Regression: a `\s*$` right anchor made the strip fire only when the
    // extension was the literal end of the field, so anything after it — a name,
    // an instruction — kept the extension digits and produced a plausible wrong
    // number. `sms:555010203012` texts a stranger; that is the failure mode this
    // whole function exists to avoid.
    expect(smsHref('555-010-2030 ext 12 (Dana)')).toBe('sms:5550102030')
    expect(smsHref('555-010-2030 ext 12 - ask for Dana')).toBe('sms:5550102030')
    expect(smsHref('555-010-2030 extension 12')).toBe('sms:5550102030')
    // Two markers: the first one ends the number, the second is inside the note.
    expect(smsHref('555-0100 x2 x3')).toBe('sms:5550100')
  })

  it('yields an empty target rather than a wrong number when the marker leads the field', () => {
    // Error case, and a deliberate over-strip: everything past the marker goes,
    // including the number itself. An empty composer is visibly wrong and
    // correctable; `sms:125550102030` is not.
    expect(smsHref('ext 12 555-010-2030')).toBe('sms:')
  })

  it('keeps the number when an x sits inside a word rather than marking an extension', () => {
    // Regression: an unanchored `x.*$` matched the `x` in "Text" and "fax" and
    // returned a bare `sms:` for a number that was right there in the field.
    expect(smsHref('Text 555-0100')).toBe('sms:5550100')
    expect(smsHref('fax: 555-0100')).toBe('sms:5550100')
    // Names ending in `x` are the same hazard and the left guard is what stops
    // them — worth pinning, since the trailing `.*$` would otherwise eat the
    // whole field from the `x` in "Alex" onward.
    expect(smsHref('Alex 555-010-2030')).toBe('sms:5550102030')
  })

  it('yields an empty target for a phone with nothing dialable in it', () => {
    // Error case: the field held free text, not a number. `isPresent` says the
    // column is filled, so this *does* render as a live link — tapping it opens
    // the composer with an empty To field for the operator to fill in, the same
    // correctable-recipient bargain `mailtoHref` makes. It must not produce
    // `sms:undefined` or throw.
    expect(smsHref('   ')).toBe('sms:')
    expect(smsHref('call the yard')).toBe('sms:')
  })
})

describe('mailtoHref', () => {
  it('builds a mailto for a trimmed address', () => {
    expect(mailtoHref('  dana@acme-industrial.test  ')).toBe(
      'mailto:dana@acme-industrial.test',
    )
  })

  it('percent-encodes the local part', () => {
    expect(mailtoHref('dana+orders@acme-industrial.test')).toBe(
      'mailto:dana%2Borders@acme-industrial.test',
    )
  })

  it('leaves a well-formed domain untouched', () => {
    // Letters, digits, dots and hyphens survive `encodeURIComponent`, so
    // encoding the domain costs nothing on real addresses.
    expect(mailtoHref('dana@acme-industrial.test')).toBe('mailto:dana@acme-industrial.test')
  })

  it('encodes mailto instructions smuggled in after the domain', () => {
    // Error case: the email column is hand-typed free text. Left raw, this would
    // open a draft with a silent CC that reads as entirely normal.
    expect(mailtoHref('dana@acme.test?subject=Invoice&body=hi')).toBe(
      'mailto:dana@acme.test%3Fsubject%3DInvoice%26body%3Dhi',
    )
  })

  it('neutralises a smuggled CC even though the extra @ moves the split', () => {
    // `lastIndexOf('@')` lands inside the injected address, so the split is
    // nonsense — but every `?`, `=` and `&` is still encoded on both sides, which
    // is what actually matters. One unusable recipient, no hidden CC.
    expect(mailtoHref('dana@acme.test?cc=rival@competitor.test')).toBe(
      'mailto:dana%40acme.test%3Fcc%3Drival@competitor.test',
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

describe('isReachable', () => {
  it('is true when either channel is on file', () => {
    expect(isReachable(makeContact({ email: null }))).toBe(true)
    expect(isReachable(makeContact({ phone: null }))).toBe(true)
  })

  it('is false when both channels are null, empty or whitespace-only', () => {
    expect(isReachable(makeContact({ email: null, phone: null }))).toBe(false)
    expect(isReachable(makeContact({ email: '   ', phone: '' }))).toBe(false)
  })
})

describe('hasAnyChannel', () => {
  it('is true when one contact has a phone and another has an email', () => {
    expect(hasAnyChannel([makeContact({ email: null }), makeContact({ phone: null })])).toBe(true)
  })

  it('is false for an empty contact list', () => {
    expect(hasAnyChannel([])).toBe(false)
  })

  it('is false when every contact is whitespace-only on both channels', () => {
    expect(
      hasAnyChannel([
        makeContact({ email: '   ', phone: '' }),
        makeContact({ email: null, phone: null }),
      ]),
    ).toBe(false)
  })
})
