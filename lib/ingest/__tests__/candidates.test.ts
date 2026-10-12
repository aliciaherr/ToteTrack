import { describe, it, expect } from 'vitest'
import { documentPathFor, noPoFound, recordableMimeType, selectCandidates } from '../candidates'
import { ACCEPTED_MIME_TYPES, PO_DOCUMENT_EXTENSIONS, PO_DOCUMENT_PATH_PREFIX } from '../ingest.constants'
import { MAX_ATTACHMENT_BYTES, MAX_RECORDED_MIME_TYPE_LENGTH } from '../limits.constants'
import type { InboundAttachment, InboundMessage } from '../types'

// Pure functions over a parsed message: no mailbox, database or bucket.
// Fixtures are invented and carry no real PO data (SEC-01).
const SOME_BYTES = Buffer.from('fake document bytes')
const BODY_PO_TEXT = 'Please supply 40 totes against PO 10042, delivery 14 October.'

function attachment(mimeType: string, bytes: Buffer = SOME_BYTES, filename: string | null = 'po-10042.bin'): InboundAttachment {
  return { filename, mimeType, bytes }
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    uid: 1,
    messageId: null,
    from: null,
    subject: null,
    receivedAt: null,
    arrivedAt: null,
    bodyText: '',
    attachments: [],
    rejection: null,
    ...overrides,
  }
}

describe('selectCandidates — accepted types (CONSTRAINT-35)', () => {
  it('accepts exactly pdf, jpeg, png and webp, with no refusals', () => {
    const selection = selectCandidates(
      message({ attachments: ACCEPTED_MIME_TYPES.map((mimeType) => attachment(mimeType)) })
    )

    expect(selection.rejections).toEqual([])
    expect(selection.candidates.map((candidate) => candidate.mimeType)).toEqual([...ACCEPTED_MIME_TYPES])
    expect(selection.candidates.map((candidate) => candidate.sourceKind)).toEqual(['pdf', 'image', 'image', 'image'])
  })

  it('accepts the image/jpg alias as image/jpeg', () => {
    const selection = selectCandidates(message({ attachments: [attachment('image/jpg')] }))

    expect(selection.rejections).toEqual([])
    expect(selection.candidates[0].mimeType).toBe('image/jpeg')
  })

  it.each(['image/svg+xml', 'image/heic', 'image/tiff', 'image/gif'])(
    'refuses %s as unsupported_format, naming the type',
    (mimeType) => {
      const selection = selectCandidates(message({ attachments: [attachment(mimeType)] }))

      expect(selection.candidates).toEqual([])
      expect(selection.rejections).toEqual([
        { check: 'ingest_limit', reason: 'unsupported_format', part: 'attachment-0', mimeType },
      ])
    }
  )

  it('refuses the unsupported part and keeps its accepted sibling', () => {
    const selection = selectCandidates(
      message({ attachments: [attachment('image/gif'), attachment('application/pdf')] })
    )

    expect(selection.candidates).toHaveLength(1)
    expect(selection.candidates[0].mimeType).toBe('application/pdf')
    expect(selection.rejections).toEqual([
      { check: 'ingest_limit', reason: 'unsupported_format', part: 'attachment-0', mimeType: 'image/gif' },
    ])
  })
})

describe('selectCandidates — no silent drops (CONSTRAINT-34)', () => {
  it('refuses an empty accepted attachment as empty_attachment', () => {
    const selection = selectCandidates(
      message({ attachments: [attachment('application/pdf', Buffer.alloc(0))] })
    )

    expect(selection.candidates).toEqual([])
    expect(selection.rejections).toEqual([
      { check: 'ingest_limit', reason: 'empty_attachment', part: 'attachment-0', mimeType: 'application/pdf' },
    ])
  })

  it('reports an empty unsupported attachment as the format problem', () => {
    const selection = selectCandidates(message({ attachments: [attachment('image/heic', Buffer.alloc(0))] }))

    expect(selection.rejections.map((failure) => failure.reason)).toEqual(['unsupported_format'])
  })

  it('returns exactly one no_po_found refusal when there is nothing to read', () => {
    const selection = selectCandidates(message({ bodyText: '  \n-- \nDana Fixture' }))

    expect(selection).toEqual({ candidates: [], rejections: [noPoFound()] })
    expect(noPoFound()).toEqual({ check: 'ingest_limit', reason: 'no_po_found', part: 'message' })
  })

  it('adds no no_po_found when another refusal already makes the message visible', () => {
    const selection = selectCandidates(message({ attachments: [attachment('image/tiff')] }))

    expect(selection.rejections.map((failure) => failure.reason)).toEqual(['unsupported_format'])
  })

  it('falls back to the body beside a refused attachment', () => {
    const selection = selectCandidates(
      message({ bodyText: BODY_PO_TEXT, attachments: [attachment('image/gif')] })
    )

    expect(selection.candidates.map((candidate) => candidate.sourceKind)).toEqual(['email_body'])
    expect(selection.rejections).toHaveLength(1)
  })

  it('still refuses an oversized accepted attachment by size', () => {
    const selection = selectCandidates(
      message({ attachments: [attachment('image/png', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))] })
    )

    expect(selection.rejections.map((failure) => failure.reason)).toEqual(['attachment_too_large'])
  })

  // SEC-05: the refusal names the part by index and the type, never the filename.
  it('puts no filename in a refusal', () => {
    const selection = selectCandidates(
      message({ attachments: [attachment('image/gif', SOME_BYTES, 'acme-po-10042-signature.gif')] })
    )

    expect(JSON.stringify(selection.rejections)).not.toContain('acme')
  })
})

describe('recordableMimeType', () => {
  it('keeps a bare type/subtype, lowercased and stripped of parameters', () => {
    expect(recordableMimeType(' Image/HEIC; name="x.heic"')).toBe('image/heic')
  })

  it('drops a value that is not a plain type/subtype', () => {
    expect(recordableMimeType('not a mime type')).toBeUndefined()
    expect(recordableMimeType('image/<script>')).toBeUndefined()
    expect(recordableMimeType('')).toBeUndefined()
  })

  it('drops a value longer than the recorded cap rather than truncating it', () => {
    const long = `application/${'x'.repeat(MAX_RECORDED_MIME_TYPE_LENGTH)}`

    expect(recordableMimeType(long)).toBeUndefined()
  })

  it('records the refusal with no type when the sender sent garbage', () => {
    const selection = selectCandidates(message({ attachments: [attachment('<<garbage>>')] }))

    expect(selection.rejections).toEqual([
      { check: 'ingest_limit', reason: 'unsupported_format', part: 'attachment-0' },
    ])
  })
})

describe('documentPathFor', () => {
  it('maps every accepted type to its extension under the inbound prefix', () => {
    for (const mimeType of ACCEPTED_MIME_TYPES) {
      expect(documentPathFor('abc123', mimeType)).toBe(
        `${PO_DOCUMENT_PATH_PREFIX}/abc123${PO_DOCUMENT_EXTENSIONS[mimeType]}`
      )
    }
  })

  it('has an extension for exactly the accepted types, with no fallback', () => {
    expect(Object.keys(PO_DOCUMENT_EXTENSIONS).sort()).toEqual([...ACCEPTED_MIME_TYPES].sort())
  })
})
