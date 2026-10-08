import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { InsertInboundEmailInput, InsertInboundPoInput } from '@/db/queries/inbound'
import { ingestMessages, type IngestDeps } from '../pipeline'
import { contentHash, normalizeBodyForHash } from '../hash'
import { PO_DOCUMENTS_BUCKET, PO_DOCUMENT_PATH_PREFIX } from '../ingest.constants'
import type { InboundAttachment, InboundMessage } from '../types'

// No database, no bucket, no mailbox. Every field of `IngestDeps` is required
// with no default, so the fake below is the only thing these tests can write
// to — nothing here can reach live data by forgetting a stub (SEC-01).
//
// Fixtures are invented POs on the reserved `.test` TLD, which can never
// resolve, and the "PDF" is a few bytes that only look like one.
const FAKE_PDF_BYTES = Buffer.from('%PDF-1.4\nfake purchase order fixture\n%%EOF\n')
const OTHER_PDF_BYTES = Buffer.from('%PDF-1.4\na second fake purchase order\n%%EOF\n')
const BODY_PO_TEXT = 'Please supply 40 totes against PO 10042, delivery 14 October.'

function attachment(mimeType: string, bytes: Buffer, filename: string | null): InboundAttachment {
  return { filename, mimeType, bytes }
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: '<po-10042@orders.invalid.test>',
    from: 'Acme Orders <orders@invalid.test>',
    subject: 'PO 10042 attached',
    receivedAt: new Date('2026-10-07T14:15:00.000Z'),
    bodyText: 'Please see the attached purchase order.',
    attachments: [attachment('application/pdf', FAKE_PDF_BYTES, 'po-10042.pdf')],
    ...overrides,
  }
}

interface Recorder {
  deps: IngestDeps
  emails: InsertInboundEmailInput[]
  pos: InsertInboundPoInput[]
  uploads: { path: string; contentType: string; bytes: number }[]
}

/**
 * A fake data layer that behaves like the real one where behaviour matters:
 * `insertEmail` reports a repeat `message_id` as `{ duplicate: true }` the way
 * the unique index makes the query helper do, and `findPoByHash` answers from
 * the rows this fake has already accepted.
 */
function recorder(overrides: Partial<IngestDeps> = {}): Recorder {
  const emails: InsertInboundEmailInput[] = []
  const pos: InsertInboundPoInput[] = []
  const uploads: { path: string; contentType: string; bytes: number }[] = []
  const deps: IngestDeps = {
    insertEmail: async (input) => {
      if (emails.some((seen) => seen.message_id === input.message_id)) return { duplicate: true }
      emails.push(input)
      return { id: `email-${emails.length}` }
    },
    insertPo: async (input) => {
      pos.push(input)
      return { id: `po-${pos.length}` }
    },
    findPoByHash: async (hash) => {
      const index = pos.findIndex((row) => row.content_hash === hash)
      return index === -1 ? null : { id: `po-${index + 1}` }
    },
    uploadDocument: async (uploadPath, bytes, contentType) => {
      uploads.push({ path: uploadPath, contentType, bytes: bytes.length })
    },
    ...overrides,
  }
  return { deps, emails, pos, uploads }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ingestMessages', () => {
  it('stages one email, one PO row and one upload for an email carrying one PDF', async () => {
    const fake = recorder()

    const summary = await ingestMessages([message()], fake.deps)

    expect(summary).toMatchObject({
      messagesSeen: 1,
      emailsStaged: 1,
      posStaged: 1,
      duplicatesFlagged: 0,
      alreadyStaged: 0,
      failedMessageIds: [],
    })

    expect(fake.emails).toHaveLength(1)
    expect(fake.emails[0]).toMatchObject({
      message_id: '<po-10042@orders.invalid.test>',
      classification: 'po_found',
      from_address: 'Acme Orders <orders@invalid.test>',
      subject: 'PO 10042 attached',
    })

    const expectedHash = contentHash(FAKE_PDF_BYTES)
    expect(fake.uploads).toEqual([
      {
        path: `${PO_DOCUMENT_PATH_PREFIX}/${expectedHash}.pdf`,
        contentType: 'application/pdf',
        bytes: FAKE_PDF_BYTES.length,
      },
    ])

    expect(fake.pos).toHaveLength(1)
    expect(fake.pos[0]).toEqual({
      inbound_email_id: 'email-1',
      source_kind: 'pdf',
      document_path: `${PO_DOCUMENT_PATH_PREFIX}/${expectedHash}.pdf`,
      content_hash: expectedHash,
      duplicate_of_id: null,
    })
    // `status` and `attempt_count` are left to their column defaults, so the
    // starting state has one definition and nothing can be auto-approved here.
    expect(fake.pos[0]).not.toHaveProperty('status')
  })

  // The required error case. The upload is attempted before the email row is
  // written, so the stored classification already reflects the failure — the
  // Task 95 data layer has no classification update to correct it later.
  it('creates no PO row and classifies the email failed when the upload rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const attempted: string[] = []
    const fake = recorder({
      uploadDocument: async (uploadPath) => {
        attempted.push(uploadPath)
        throw new Error('storage unavailable')
      },
    })
    const failing = message({ messageId: '<upload-fails@invalid.test>' })
    // Body-only, so it needs no upload and still stages behind the failure.
    const following = message({
      messageId: '<po-10043@orders.invalid.test>',
      bodyText: BODY_PO_TEXT,
      attachments: [],
    })

    const summary = await ingestMessages([failing, following], fake.deps)

    expect(attempted).toHaveLength(1)
    expect(summary.failedMessageIds).toEqual(['<upload-fails@invalid.test>'])

    // The email is still recorded — nothing is silently discarded — but with
    // no PO row, so no row points at an object that was never written.
    expect(fake.emails.map((row) => row.classification)).toEqual(['failed', 'po_found'])
    expect(fake.pos).toHaveLength(1)
    expect(fake.pos[0]).toMatchObject({ inbound_email_id: 'email-2', source_kind: 'email_body' })
    expect(summary.emailsStaged).toBe(2)

    const logged = consoleError.mock.calls.flat()
    expect(JSON.stringify(logged)).toContain('<upload-fails@invalid.test>')
    expect(JSON.stringify(logged)).not.toContain('purchase order')
  })

  it('stages one PO row per accepted attachment', async () => {
    const fake = recorder()
    const three = message({
      attachments: [
        attachment('application/pdf', FAKE_PDF_BYTES, 'po-1.pdf'),
        attachment('image/jpeg', OTHER_PDF_BYTES, 'po-2.jpg'),
        attachment('image/png', Buffer.from('fake png bytes'), null),
      ],
    })

    const summary = await ingestMessages([three], fake.deps)

    expect(summary.posStaged).toBe(3)
    expect(fake.uploads).toHaveLength(3)
    expect(fake.pos.map((row) => row.source_kind)).toEqual(['pdf', 'image', 'image'])
    expect(fake.pos.every((row) => row.document_path !== null)).toBe(true)
  })

  it('ignores an attachment whose type is not accepted and falls back to the body', async () => {
    const fake = recorder()
    const spreadsheet = message({
      bodyText: BODY_PO_TEXT,
      attachments: [attachment('application/vnd.ms-excel', Buffer.from('not a PO'), 'book.xls')],
    })

    await ingestMessages([spreadsheet], fake.deps)

    expect(fake.uploads).toHaveLength(0)
    expect(fake.pos).toHaveLength(1)
    expect(fake.pos[0].source_kind).toBe('email_body')
  })

  it('gives a body-only PO the normalised-body hash and no document path', async () => {
    const fake = recorder()
    const bodyOnly = message({ bodyText: `> ${BODY_PO_TEXT}\n\n-- \nDana Fixture`, attachments: [] })

    await ingestMessages([bodyOnly], fake.deps)

    expect(fake.uploads).toHaveLength(0)
    expect(fake.pos[0]).toMatchObject({
      source_kind: 'email_body',
      document_path: null,
      content_hash: contentHash(normalizeBodyForHash(BODY_PO_TEXT)),
    })
  })

  // A duplicate is a flag, not a rejection: the row still reaches the review
  // queue so a human decides.
  it('still inserts a repeat content hash, with duplicate_of_id set', async () => {
    const fake = recorder()
    const first = message({ messageId: '<first-sighting@invalid.test>' })
    const forwarded = message({ messageId: '<forwarded-again@invalid.test>' })

    const summary = await ingestMessages([first, forwarded], fake.deps)

    expect(summary.posStaged).toBe(2)
    expect(summary.duplicatesFlagged).toBe(1)
    expect(fake.pos[0].duplicate_of_id).toBeNull()
    expect(fake.pos[1].duplicate_of_id).toBe('po-1')
    expect(fake.pos[1].content_hash).toBe(fake.pos[0].content_hash)
  })

  it('records an email with no candidate PO as no_po_found', async () => {
    const fake = recorder()
    const empty = message({
      bodyText: '---------- Forwarded message ---------\nSubject: PO 10042\n-- \nDana Fixture',
      attachments: [],
    })

    const summary = await ingestMessages([empty], fake.deps)

    expect(fake.emails[0].classification).toBe('no_po_found')
    expect(fake.pos).toHaveLength(0)
    expect(summary.emailsStaged).toBe(1)
  })

  it('writes nothing new and reuses one storage key when the same batch runs twice', async () => {
    const fake = recorder()
    const batch = [message()]

    await ingestMessages(batch, fake.deps)
    const second = await ingestMessages(batch, fake.deps)

    expect(second.alreadyStaged).toBe(1)
    expect(second.emailsStaged).toBe(0)
    expect(second.posStaged).toBe(0)
    expect(fake.emails).toHaveLength(1)
    expect(fake.pos).toHaveLength(1)
    // The second upload is content-addressed to the same key, so the bucket
    // holds one object rather than two.
    expect(new Set(fake.uploads.map((upload) => upload.path)).size).toBe(1)
  })

  // EH-01 / EH-02: one bad message must never abort the batch.
  it('logs a database failure with its message id and keeps processing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = recorder()
    const insertPo = fake.deps.insertPo
    let calls = 0
    fake.deps.insertPo = async (input) => {
      calls += 1
      if (calls === 1) throw new Error('insert failed')
      return insertPo(input)
    }

    const summary = await ingestMessages(
      [
        message({ messageId: '<db-fails@invalid.test>' }),
        message({ messageId: '<ok@invalid.test>' }),
      ],
      fake.deps
    )

    expect(summary.failedMessageIds).toEqual(['<db-fails@invalid.test>'])
    expect(summary.posStaged).toBe(1)
    expect(JSON.stringify(consoleError.mock.calls.flat())).toContain('<db-fails@invalid.test>')
  })

  it('returns a zero summary for an empty batch without touching the data layer', async () => {
    const fake = recorder()

    const summary = await ingestMessages([], fake.deps)

    expect(summary).toEqual({
      messagesSeen: 0,
      emailsStaged: 0,
      alreadyStaged: 0,
      posStaged: 0,
      duplicatesFlagged: 0,
      failedMessageIds: [],
    })
    expect(fake.emails).toHaveLength(0)
  })
})

// Asserted against the source, because these are claims about what the module
// may not contain. A runtime database or storage import is what would make it
// untestable without both, and the Task 96 / 97 split exists to keep it out.
describe('pipeline.ts source constraints', () => {
  const source = readFileSync(path.join(__dirname, '..', 'pipeline.ts'), 'utf8')
  const candidates = readFileSync(path.join(__dirname, '..', 'candidates.ts'), 'utf8')

  it('imports no runtime value from the database or the Supabase client', () => {
    for (const moduleSource of [source, candidates]) {
      expect(moduleSource).not.toMatch(/^import \{[^}]*\} from '@\/db/m)
      expect(moduleSource).not.toMatch(/from '@\/lib\/supabase/)
      expect(moduleSource).toMatch(/^import type \{/m)
    }
  })

  it('names one bucket, from the constants file, and logs nothing', () => {
    expect(PO_DOCUMENTS_BUCKET).toBe('po-documents')
    expect(source).not.toContain(`'${PO_DOCUMENTS_BUCKET}'`)
    expect(source).not.toContain('console.log')
  })
})
