import { describe, it, expect } from 'vitest'
import type { ReviewSourceRow } from '@/db/queries/review-source'
import type { IngestLimitFailure, IngestLimitReason } from '@/lib/ingest/types'
import { MAX_TEXT_INPUT_CHARS } from '@/lib/extraction/extraction.constants'
import { bodySourceOf, capBodyText, describeRefusal, gmailSearchUrl, refusalOf } from '../review-source'
import { ReviewSourceShapeError, UnknownRefusalReasonError } from '../errors'

const PO_ID = '22222222-2222-2222-2222-222222222222'

function failure(reason: IngestLimitReason, extra: Partial<IngestLimitFailure> = {}): IngestLimitFailure {
  return { check: 'ingest_limit', reason, part: 'message', ...extra }
}

function row(overrides: Partial<ReviewSourceRow> = {}): ReviewSourceRow {
  return {
    id: PO_ID,
    source_kind: 'email_body',
    document_path: null,
    body_text: null,
    check_results: null,
    extracted: null,
    duplicate_of_id: null,
    from_address: 'buyer@example.com',
    subject: 'PO 4471',
    received_at: '2026-10-12T15:04:05.000Z',
    message_id: '<m1@example.com>',
    ...overrides,
  }
}

describe('refusalOf', () => {
  it('finds the ingest_limit entry among other failures', () => {
    const refusal = failure('unparseable')
    expect(refusalOf({ failures: [{ check: 'total_mismatch' }, refusal] })).toEqual(refusal)
  })

  it.each([null, 'text', {}, { failures: 'x' }, { failures: [{ check: 'other' }] }])('returns null for %j', (value) => {
    expect(refusalOf(value)).toBeNull()
  })
})

describe('describeRefusal', () => {
  const cases: [IngestLimitReason, RegExp][] = [
    ['message_too_large', /too large/i],
    ['attachment_too_large', /over 15 MB/],
    ['too_many_attachments', /more than 10 attachments/i],
    ['unparseable', /couldn't be read/i],
    ['size_not_declared', /size unknown/i],
    ['unsupported_format', /not supported/i],
    ['empty_attachment', /empty/i],
    ['no_po_found', /no PO found/i],
    ['staging_failed', /couldn't be imported/i],
  ]

  it.each(cases)('words %s', (reason, title) => {
    const description = describeRefusal(failure(reason))
    expect(description.title).toMatch(title)
    expect(description.nextStep.length).toBeGreaterThan(0)
  })

  it('tells a staging failure to recover the PO from Gmail (LOW-NEW-3)', () => {
    const { title, nextStep } = describeRefusal(failure('staging_failed'))
    expect(`${title}. ${nextStep}`).toBe("Couldn't be imported. Open it in Gmail to recover the PO.")
  })

  it('carries the file type, or null without one', () => {
    expect(describeRefusal(failure('unsupported_format', { mimeType: 'application/zip' })).fileType).toBe('application/zip')
    expect(describeRefusal(failure('unparseable')).fileType).toBeNull()
  })

  it('throws for a reason it has no wording for', () => {
    const unknown = failure('brand_new_reason' as IngestLimitReason)
    expect(() => describeRefusal(unknown)).toThrow(UnknownRefusalReasonError)
  })

  it('does not treat an inherited property as a reason', () => {
    expect(() => describeRefusal(failure('toString' as IngestLimitReason))).toThrow(UnknownRefusalReasonError)
  })
})

describe('gmailSearchUrl', () => {
  it('URL-encodes an rfc822msgid search', () => {
    expect(gmailSearchUrl('<a+b@example.com>')).toBe(
      'https://mail.google.com/mail/u/0/#search/rfc822msgid%3A%3Ca%2Bb%40example.com%3E',
    )
  })

  it('returns null without a message id', () => {
    expect(gmailSearchUrl(null)).toBeNull()
    expect(gmailSearchUrl('')).toBeNull()
  })
})

describe('capBodyText', () => {
  it('returns a body exactly at the cap whole', () => {
    const text = 'x'.repeat(MAX_TEXT_INPUT_CHARS)
    expect(capBodyText(text)).toEqual({ text, truncated: false })
  })

  it('returns only the start of a body over the cap', () => {
    const capped = capBodyText('x'.repeat(MAX_TEXT_INPUT_CHARS + 1))
    expect(capped).toEqual({ text: 'x'.repeat(MAX_TEXT_INPUT_CHARS), truncated: true })
  })

  it('never cuts a two-unit character in half at the cap', () => {
    const text = `${'x'.repeat(MAX_TEXT_INPUT_CHARS - 1)}\u{1F4E6}tail`
    const capped = capBodyText(text)
    expect(capped.truncated).toBe(true)
    expect(capped.text).toBe('x'.repeat(MAX_TEXT_INPUT_CHARS - 1))
  })
})

describe('bodySourceOf', () => {
  it('returns the body text for an email-body PO', () => {
    expect(bodySourceOf(row({ body_text: '<b>300 totes</b>' }))).toEqual({ kind: 'text', text: '<b>300 totes</b>', truncated: false })
  })

  it('caps a body over MAX_TEXT_INPUT_CHARS and flags it truncated (LOW-T106-1)', () => {
    const body = 'x'.repeat(MAX_TEXT_INPUT_CHARS + 5)
    expect(bodySourceOf(row({ body_text: body }))).toEqual({
      kind: 'text',
      text: 'x'.repeat(MAX_TEXT_INPUT_CHARS),
      truncated: true,
    })
  })

  it('returns the refusal card data for a refused row', () => {
    const source = bodySourceOf(row({ check_results: { failures: [failure('no_po_found')] } }))
    expect(source).toMatchObject({
      kind: 'refused',
      refusal: { title: 'No PO found in this email' },
      email: { from: 'buyer@example.com', subject: 'PO 4471', gmailUrl: expect.stringContaining('rfc822msgid') },
    })
  })

  it('throws when the row has no text and no refusal', () => {
    expect(() => bodySourceOf(row())).toThrow(ReviewSourceShapeError)
  })
})
