import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { ContentHashError } from '@/lib/errors'
import { contentHash, normalizeBodyForHash } from '../hash'

// Pure functions over bytes and text: no mailbox, no database, no bucket.
// Every fixture below is invented PO text with a reserved `.test` address, so
// nothing here resembles real customer data (SEC-01).
const FAKE_PDF_BYTES = Buffer.from('%PDF-1.4\nfake purchase order fixture\n%%EOF\n')

const ORIGINAL_BODY = [
  'Hi,',
  '',
  'Please supply 40 totes against PO 10042, delivery 14 October.',
  'Ship to the Dallas dock.',
  '',
  'Thanks,',
  '-- ',
  'Dana Fixture | Acme Orders | +1 555 0100',
].join('\n')

// The same body as Gmail relays it: an attribution line, a forward banner, a
// re-emitted header block, and every original line quoted with `>`.
const GMAIL_FORWARD = [
  'FYI - see below.',
  '',
  '---------- Forwarded message ---------',
  'From: Dana Fixture <orders@invalid.test>',
  'Date: Tue, 6 Oct 2026 at 09:15',
  'Subject: PO 10042',
  'To: Sales <sales@invalid.test>',
  '',
  '> Hi,',
  '>',
  '> Please supply 40 totes against PO 10042, delivery 14 October.',
  '> Ship to the Dallas dock.',
  '>',
  '> Thanks,',
  '> -- ',
  '> Dana Fixture | Acme Orders | +1 555 0100',
].join('\r\n')

// And as Outlook relays it: its own separator, no `>` markers, different
// header order and spacing, and the body re-wrapped.
const OUTLOOK_FORWARD = [
  'FYI - see below.',
  '',
  '_________________________________',
  'From: Dana Fixture <orders@invalid.test>',
  'Sent: Tuesday, October 6, 2026 9:15 AM',
  'To: Sales <sales@invalid.test>',
  'Subject: PO 10042',
  '',
  'Hi,',
  '',
  'Please supply 40 totes against PO 10042,',
  'delivery 14 October.',
  '    Ship to the Dallas dock.',
  '',
  'Thanks,',
  '--',
  'Dana Fixture | Acme Orders | +1 555 0100',
].join('\r\n')

describe('contentHash', () => {
  it('returns the hex SHA-256 of the given bytes', () => {
    const expected = createHash('sha256').update(FAKE_PDF_BYTES).digest('hex')

    expect(contentHash(FAKE_PDF_BYTES)).toBe(expected)
    expect(contentHash(FAKE_PDF_BYTES)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes a string and the same string as bytes identically', () => {
    expect(contentHash('PO 10042')).toBe(contentHash(Buffer.from('PO 10042')))
  })

  it('gives two different documents two different hashes', () => {
    expect(contentHash(FAKE_PDF_BYTES)).not.toBe(contentHash(Buffer.from('a different PO')))
  })

  // Error case. Every empty candidate hashes identically, so returning the
  // digest of nothing would stage the first and flag every later one as its
  // duplicate — dedupe would go quiet instead of loud.
  it('throws rather than returning the hash of nothing for an empty buffer', () => {
    expect(() => contentHash(Buffer.alloc(0))).toThrow(ContentHashError)
    expect(() => contentHash(Buffer.alloc(0))).toThrow(/empty buffer/)
  })

  it('throws for an empty or whitespace-only string', () => {
    expect(() => contentHash('')).toThrow(ContentHashError)
    expect(() => contentHash('   \n\t ')).toThrow(ContentHashError)
    expect(() => contentHash('')).toThrow(/no_po_found/)
  })
})

describe('normalizeBodyForHash', () => {
  // The acceptance criterion: the same PO forwarded twice, by two clients
  // that rewrite it differently, must reach one hash.
  it('hashes two forwarded variants of one body equal', () => {
    const gmail = normalizeBodyForHash(GMAIL_FORWARD)
    const outlook = normalizeBodyForHash(OUTLOOK_FORWARD)

    expect(gmail).not.toBe('')
    expect(gmail).toBe(outlook)
    expect(contentHash(gmail)).toBe(contentHash(outlook))
  })

  it('keeps the PO content and drops the signature and the quoted headers', () => {
    const normalised = normalizeBodyForHash(GMAIL_FORWARD)

    expect(normalised).toContain('PO 10042')
    expect(normalised).toContain('Dallas dock')
    expect(normalised).not.toContain('555 0100')
    expect(normalised).not.toContain('Forwarded message')
    expect(normalised).not.toContain('orders@invalid.test')
    expect(normalised).not.toContain('>')
  })

  it('collapses the line breaks and indentation a client re-wraps', () => {
    expect(normalizeBodyForHash('PO 10042\r\n\r\n   40   totes\n')).toBe('PO 10042 40 totes')
  })

  // Under-stripping is the deliberate trade-off: a missed duplicate reaches
  // the review queue, while a false match would label a new PO a copy of an
  // unrelated one. Two different POs must not collapse onto one hash.
  it('keeps two different POs distinct', () => {
    const other = ORIGINAL_BODY.replace('PO 10042', 'PO 10043')

    expect(normalizeBodyForHash(ORIGINAL_BODY)).not.toBe(normalizeBodyForHash(other))
  })

  it('returns an empty string when nothing but relay noise survives', () => {
    expect(normalizeBodyForHash('')).toBe('')
    const noiseOnly = [
      '> ---------- Forwarded message ---------',
      '> Subject: PO 10042',
      '-- ',
      'Dana Fixture',
    ].join('\n')
    expect(normalizeBodyForHash(noiseOnly)).toBe('')
  })
})
