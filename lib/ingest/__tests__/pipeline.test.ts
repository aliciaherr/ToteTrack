import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inspect } from 'node:util'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from '@/lib/errors'
import type { InsertInboundEmailInput } from '@/db/queries/inbound-emails'
import { ingestMessages, type IngestDeps } from '../pipeline'
import { contentHash, normalizeBodyForHash, refusalHash } from '../hash'
import { PO_DOCUMENTS_BUCKET, PO_DOCUMENT_PATH_PREFIX } from '../ingest.constants'
import { MAX_ATTACHMENTS_PER_EMAIL, MAX_ATTACHMENT_BYTES, MAX_TOTAL_INGEST_BYTES } from '../limits.constants'
import { type StagedPoInput } from '../limits'
import type { IngestLimitFailure, InboundAttachment, InboundMessage } from '../types'

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
  return { filename, mimeType, bytes, embedded: false }
}

const UID_VALIDITY = 7

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    uid: 1,
    messageId: '<po-10042@orders.invalid.test>',
    from: 'Acme Orders <orders@invalid.test>',
    subject: 'PO 10042 attached',
    receivedAt: new Date('2026-10-07T14:15:00.000Z'),
    arrivedAt: null,
    bodyText: 'Please see the attached purchase order.',
    attachments: [attachment('application/pdf', FAKE_PDF_BYTES, 'po-10042.pdf')],
    rejection: null,
    ...overrides,
  }
}

/** A PO row as the fake data layer stored it, with the columns it resolves. */
type RecordedPo = StagedPoInput & { inbound_email_id: string; duplicate_of_id: string | null }

interface Recorder {
  deps: IngestDeps
  emails: InsertInboundEmailInput[]
  pos: RecordedPo[]
  uploads: { path: string; contentType: string; bytes: number }[]
}

/**
 * A fake data layer that behaves like `stageEmailWithPos` where behaviour
 * matters: a repeat `(uid_validity, uid)` is reported as `{ duplicate: true }`
 * with nothing written, and a repeat hash is pointed at its first sighting.
 */
function recorder(overrides: Partial<IngestDeps> = {}): Recorder {
  const emails: InsertInboundEmailInput[] = []
  const pos: RecordedPo[] = []
  const uploads: { path: string; contentType: string; bytes: number }[] = []
  const deps: IngestDeps = {
    stageEmail: async (email, rows) => {
      const staged = emails.some(
        (seen) => seen.uid_validity === email.uid_validity && seen.uid === email.uid
      )
      if (staged) return { duplicate: true }
      emails.push(email)
      const emailId = `email-${emails.length}`
      let duplicatesFlagged = 0
      for (const row of rows) {
        const index = pos.findIndex((earlier) => earlier.content_hash === row.content_hash)
        if (index !== -1) duplicatesFlagged += 1
        pos.push({ ...row, inbound_email_id: emailId, duplicate_of_id: index === -1 ? null : `po-${index + 1}` })
      }
      return { id: emailId, duplicatesFlagged }
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

    const summary = await ingestMessages([message()], UID_VALIDITY, fake.deps)

    expect(summary).toMatchObject({
      messagesSeen: 1,
      emailsStaged: 1,
      posStaged: 1,
      duplicatesFlagged: 0,
      refusalsRecorded: 0,
      alreadyStaged: 0,
      committedUids: [1],
      failedUids: [],
    })

    expect(fake.emails).toHaveLength(1)
    expect(fake.emails[0]).toMatchObject({
      uid_validity: UID_VALIDITY,
      uid: 1,
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
      body_text: null,
      content_hash: expectedHash,
      duplicate_of_id: null,
    })
    // `status` and `attempt_count` are left to their column defaults, so the
    // starting state has one definition and nothing can be auto-approved here.
    expect(fake.pos[0]).not.toHaveProperty('status')
  })

  // The required error case (CONSTRAINT-34, Task 100). An upload failure
  // throws for that message: no email row and no PO row, so nothing points at
  // a missing object, and the UID is failed so the watermark halts below it.
  it('writes nothing for a message whose upload rejects, fails its UID and continues', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const attempted: string[] = []
    const fake = recorder({
      uploadDocument: async (uploadPath) => {
        attempted.push(uploadPath)
        throw new Error('storage unavailable')
      },
    })
    // A refusable sibling too: the old path committed its refusal row alone.
    const failing = message({
      uid: 1,
      attachments: [
        attachment('application/pdf', FAKE_PDF_BYTES, 'po-10042.pdf'),
        attachment('image/svg+xml', Buffer.from('<svg/>'), 'logo.svg'),
      ],
    })
    // Body-only, so it needs no upload and still stages behind the failure.
    const following = message({ uid: 2, bodyText: BODY_PO_TEXT, attachments: [] })

    const summary = await ingestMessages([failing, following], UID_VALIDITY, fake.deps)

    expect(attempted).toHaveLength(1)
    expect(summary.failedUids).toEqual([1])
    expect(summary.committedUids).toEqual([2])
    expect(fake.emails.map((row) => row.uid)).toEqual([2])
    expect(fake.pos).toHaveLength(1)
    expect(fake.pos[0]).toMatchObject({ inbound_email_id: 'email-1', source_kind: 'email_body' })
    expect(summary).toMatchObject({ emailsStaged: 1, refusalsRecorded: 0 })

    expect(consoleError.mock.calls[0]?.[1]).toMatchObject({ uid: 1, error: 'DocumentUploadError > Error' })
    const logged = JSON.stringify(consoleError.mock.calls.flat())
    expect(logged).not.toContain('purchase order')
    expect(logged).not.toContain('po-10042.pdf')
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

    const summary = await ingestMessages([three], UID_VALIDITY, fake.deps)

    expect(summary.posStaged).toBe(3)
    expect(fake.uploads).toHaveLength(3)
    expect(fake.pos.map((row) => row.source_kind)).toEqual(['pdf', 'image', 'image'])
    expect(fake.pos.every((row) => row.document_path !== null)).toBe(true)
  })

  it('refuses an attachment whose type is not accepted and still stages the body', async () => {
    const fake = recorder()
    const spreadsheet = message({
      bodyText: BODY_PO_TEXT,
      attachments: [attachment('application/vnd.ms-excel', Buffer.from('not a PO'), 'book.xls')],
    })

    const summary = await ingestMessages([spreadsheet], UID_VALIDITY, fake.deps)

    expect(fake.uploads).toHaveLength(0)
    expect(summary).toMatchObject({ posStaged: 1, refusalsRecorded: 1 })
    expect(fake.emails[0].classification).toBe('po_found')
    expect(fake.pos.map((row) => row.source_kind)).toEqual(['email_body', 'email_body'])
    expect(fake.pos[1]).toMatchObject({
      document_path: null,
      status: 'pending_review',
      check_results: {
        failures: [
          {
            check: 'ingest_limit',
            reason: 'unsupported_format',
            part: 'attachment-0',
            mimeType: 'application/vnd.ms-excel',
          },
        ],
      },
    })
  })

  it('gives a body-only PO the normalised-body hash and no document path', async () => {
    const fake = recorder()
    const bodyOnly = message({ bodyText: `> ${BODY_PO_TEXT}\n\n-- \nDana Fixture`, attachments: [] })

    await ingestMessages([bodyOnly], UID_VALIDITY, fake.deps)

    expect(fake.uploads).toHaveLength(0)
    expect(fake.pos[0]).toMatchObject({
      source_kind: 'email_body',
      document_path: null,
      body_text: normalizeBodyForHash(BODY_PO_TEXT),
      content_hash: contentHash(normalizeBodyForHash(BODY_PO_TEXT)),
    })
  })

  // FB-42: only a body PO writes `body_text`. The 0021 CHECK would reject
  // text on a file row, and a refusal has no text worth keeping.
  it('writes NULL body_text on attachment rows and refusal rows', async () => {
    const fake = recorder()
    const mixed = message({
      bodyText: BODY_PO_TEXT,
      attachments: [
        attachment('application/pdf', Buffer.from('%PDF-1.4 fixture'), 'po.pdf'),
        attachment('application/vnd.ms-excel', Buffer.from('not a PO'), 'book.xls'),
      ],
    })

    await ingestMessages([mixed], UID_VALIDITY, fake.deps)

    expect(fake.pos.map((row) => [row.source_kind, row.body_text])).toEqual([
      ['pdf', null],
      ['email_body', null],
    ])
  })

  // A duplicate is a flag, not a rejection: the row still reaches the review
  // queue so a human decides.
  it('still inserts a repeat content hash, with duplicate_of_id set', async () => {
    const fake = recorder()
    const first = message({ uid: 1 })
    const forwarded = message({ uid: 2 })

    const summary = await ingestMessages([first, forwarded], UID_VALIDITY, fake.deps)

    expect(summary.posStaged).toBe(2)
    expect(summary.duplicatesFlagged).toBe(1)
    expect(fake.pos[0].duplicate_of_id).toBeNull()
    expect(fake.pos[1].duplicate_of_id).toBe('po-1')
    expect(fake.pos[1].content_hash).toBe(fake.pos[0].content_hash)
  })

  // CONSTRAINT-34: "ignore" is never terminal. Spam is dismissed by a human.
  it('queues exactly one no_po_found review row for an email with nothing to read', async () => {
    const fake = recorder()
    const empty = message({
      uid: 5,
      bodyText: '---------- Forwarded message ---------\nSubject: PO 10042\n-- \nDana Fixture',
      attachments: [],
    })

    const summary = await ingestMessages([empty], UID_VALIDITY, fake.deps)

    const failure: IngestLimitFailure = { check: 'ingest_limit', reason: 'no_po_found', part: 'message' }
    expect(fake.emails[0].classification).toBe('no_po_found')
    expect(fake.pos).toEqual([
      {
        inbound_email_id: 'email-1',
        source_kind: 'email_body',
        document_path: null,
        body_text: null,
        content_hash: refusalHash(UID_VALIDITY, 5, failure),
        status: 'pending_review',
        check_results: { failures: [failure] },
        duplicate_of_id: null,
      },
    ])
    expect(summary).toMatchObject({ emailsStaged: 1, posStaged: 0, refusalsRecorded: 1 })
    expect(summary.committedUids).toEqual([5])
  })

  it('writes nothing new and reuses one storage key when the same batch runs twice', async () => {
    const fake = recorder()
    const batch = [message()]

    await ingestMessages(batch, UID_VALIDITY, fake.deps)
    const second = await ingestMessages(batch, UID_VALIDITY, fake.deps)

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
  it('logs a database failure with its UID and keeps processing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = recorder()
    const stageEmail = fake.deps.stageEmail
    let calls = 0
    fake.deps.stageEmail = async (email, rows) => {
      calls += 1
      if (calls === 1) throw new Error('transaction failed')
      return stageEmail(email, rows)
    }

    const summary = await ingestMessages(
      [message({ uid: 1 }), message({ uid: 2 })],
      UID_VALIDITY,
      fake.deps
    )

    // Nothing was written for UID 1, so it halts the watermark and retries.
    expect(summary.failedUids).toEqual([1])
    expect(summary.committedUids).toEqual([2])
    expect(summary.posStaged).toBe(1)
    expect(consoleError.mock.calls.at(-1)?.[1]).toMatchObject({ uid: 1 })
  })

  // MEDIUM-04. The production failure is a DatabaseError around drizzle's
  // DrizzleQueryError, whose params are this email's headers. Node prints the
  // whole cause chain, so logging the error at all would leak them.
  it('logs a staging failure without any header value from its cause chain', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const leaky = message({ uid: 3 })
    const params = [leaky.messageId, leaky.from, leaky.subject]
    const fake = recorder({
      stageEmail: async () => {
        const driver = Object.assign(new Error('insert failed'), { code: '22021' })
        throw new DatabaseError('stageEmailWithPos', 'Failed to stage', {
          cause: new DrizzleQueryError('insert into "inbound_emails" ...', params, driver),
        })
      },
    })

    const summary = await ingestMessages([leaky], UID_VALIDITY, fake.deps)

    expect(summary.failedUids).toEqual([3])
    const sink = inspect(consoleError.mock.calls, { depth: 10 })
    for (const header of params) expect(sink).not.toContain(header as string)
    expect(consoleError.mock.calls.at(-1)?.[1]).toMatchObject({
      uid: 3,
      code: '22021',
      operation: 'stageEmailWithPos',
    })
  })

  // Architecture rule 2: the label never decides anything.
  it('stages two messages that share one Message-ID as two emails', async () => {
    const fake = recorder()
    const shared = '<same@orders.invalid.test>'

    const summary = await ingestMessages(
      [message({ uid: 1, messageId: shared }), message({ uid: 2, messageId: shared })],
      UID_VALIDITY,
      fake.deps
    )

    expect(summary).toMatchObject({ emailsStaged: 2, alreadyStaged: 0, committedUids: [1, 2] })
    expect(fake.emails.map((row) => row.uid)).toEqual([1, 2])
  })

  // H-01. A refusal is staged, never dropped: `document_path` is NULL, the
  // hash is a surrogate over the UID, and the reason is a `failures` entry —
  // which is what sorts the row to the top of the review queue.
  describe('refused messages and attachments', () => {
    const SIZE_FAILURE: IngestLimitFailure = {
      check: 'ingest_limit',
      reason: 'message_too_large',
      part: 'message',
      measured: MAX_TOTAL_INGEST_BYTES + 1,
      limit: MAX_TOTAL_INGEST_BYTES,
      unit: 'bytes',
    }

    it('stages a row at pending_review for a message refused before download', async () => {
      const fake = recorder()
      const refused = message({
        uid: 4,
        bodyText: '',
        attachments: [],
        rejection: SIZE_FAILURE,
      })

      const summary = await ingestMessages([refused], UID_VALIDITY, fake.deps)

      expect(fake.uploads).toEqual([])
      expect(summary).toMatchObject({ posStaged: 0, refusalsRecorded: 1, emailsStaged: 1 })
      expect(fake.emails[0].classification).toBe('failed')
      expect(fake.pos).toHaveLength(1)
      expect(fake.pos[0]).toMatchObject({
        source_kind: 'email_body',
        document_path: null,
        content_hash: refusalHash(UID_VALIDITY, 4, SIZE_FAILURE),
        // Straight to the queue: there is no document, so extraction could
        // never advance it off the `pending_extraction` default.
        status: 'pending_review',
        check_results: { failures: [SIZE_FAILURE] },
      })
    })

    // H-02. The row is what makes a genuinely malformed PO visible instead of
    // vanishing into a log line, and what marks the message processed so it
    // does not come back on every run forever.
    it('stages an unparseable message at pending_review with no fabricated figures', async () => {
      const fake = recorder()
      const unreadable = message({
        uid: 11,
        messageId: null,
        bodyText: '',
        attachments: [],
        rejection: { check: 'ingest_limit', reason: 'unparseable', part: 'message' },
      })

      const summary = await ingestMessages([unreadable], UID_VALIDITY, fake.deps)

      expect(fake.uploads).toEqual([])
      expect(summary).toMatchObject({ posStaged: 0, refusalsRecorded: 1, emailsStaged: 1 })
      expect(fake.emails[0].classification).toBe('failed')
      expect(fake.pos[0]).toMatchObject({
        source_kind: 'email_body',
        document_path: null,
        status: 'pending_review',
        check_results: { failures: [{ reason: 'unparseable', part: 'message' }] },
      })
      // No measured value and no limit: nothing was exceeded, so inventing
      // either would put a fabricated number in front of a reviewer.
      const [failure] = (fake.pos[0].check_results as { failures: IngestLimitFailure[] }).failures
      expect(failure.measured).toBeUndefined()
      expect(failure.limit).toBeUndefined()
      // Still a valid NOT NULL content_hash, via the UID surrogate.
      expect(fake.pos[0].content_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces the same surrogate hash each time the same refusal is seen', async () => {
      const first = recorder()
      const second = recorder()
      const refused = message({
        uid: 9,
        attachments: [],
        rejection: SIZE_FAILURE,
      })

      await ingestMessages([refused], UID_VALIDITY, first.deps)
      await ingestMessages([refused], UID_VALIDITY, second.deps)

      // Stability is what keeps a re-fetch idempotent rather than piling up a
      // fresh unrelated row every run.
      expect(second.pos[0].content_hash).toBe(first.pos[0].content_hash)
    })

    it('refuses only the oversized attachment and still stages its valid sibling', async () => {
      const fake = recorder()
      const mixed = message({
        attachments: [
          attachment('image/jpeg', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'huge-photo.jpg'),
          attachment('application/pdf', FAKE_PDF_BYTES, 'po-10042.pdf'),
        ],
      })

      const summary = await ingestMessages([mixed], UID_VALIDITY, fake.deps)

      // The valid PO is unaffected — the whole point of refusing per part.
      expect(summary).toMatchObject({ posStaged: 1, refusalsRecorded: 1 })
      expect(fake.emails[0].classification).toBe('po_found')
      expect(fake.uploads).toHaveLength(1)
      expect(fake.uploads[0].contentType).toBe('application/pdf')

      const refusal = fake.pos.find((row) => row.check_results !== undefined)
      expect(refusal?.document_path).toBeNull()
      expect(refusal?.check_results).toEqual({
        failures: [
          {
            check: 'ingest_limit',
            reason: 'attachment_too_large',
            part: 'attachment-0',
            measured: MAX_ATTACHMENT_BYTES + 1,
            limit: MAX_ATTACHMENT_BYTES,
            unit: 'bytes',
          },
        ],
      })
    })

    it('truncates to the per-email attachment cap and records the full count', async () => {
      const fake = recorder()
      const overCap = MAX_ATTACHMENTS_PER_EMAIL + 1
      const many = message({
        attachments: Array.from({ length: overCap }, (_, index) =>
          attachment('image/png', Buffer.from(`fake png bytes ${index}`), null)
        ),
      })

      const summary = await ingestMessages([many], UID_VALIDITY, fake.deps)

      expect(summary.posStaged).toBe(MAX_ATTACHMENTS_PER_EMAIL)
      expect(summary.refusalsRecorded).toBe(1)
      expect(fake.uploads).toHaveLength(MAX_ATTACHMENTS_PER_EMAIL)
      const refusal = fake.pos.find((row) => row.check_results !== undefined)
      expect(refusal?.check_results).toEqual({
        failures: [
          {
            check: 'ingest_limit',
            reason: 'too_many_attachments',
            part: 'message',
            measured: overCap,
            limit: MAX_ATTACHMENTS_PER_EMAIL,
            unit: 'attachments',
          },
        ],
      })
    })

    // CONSTRAINT-34 (Task 100): the old path logged and `continue`d.
    it('stages an empty attachment as an empty_attachment review row', async () => {
      const consoleError = vi.spyOn(console, 'error')
      const fake = recorder()
      const empty = message({ bodyText: '', attachments: [attachment('application/pdf', Buffer.alloc(0), 'po.pdf')] })

      const summary = await ingestMessages([empty], UID_VALIDITY, fake.deps)

      expect(fake.uploads).toEqual([])
      expect(summary).toMatchObject({ posStaged: 0, refusalsRecorded: 1, committedUids: [1] })
      expect(fake.emails[0].classification).toBe('failed')
      expect(fake.pos[0]).toMatchObject({
        status: 'pending_review',
        check_results: {
          failures: [{ reason: 'empty_attachment', part: 'attachment-0', mimeType: 'application/pdf' }],
        },
      })
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('classifies an email whose only attachment is unsupported as failed, not no_po_found', async () => {
      const fake = recorder()
      const photo = message({ bodyText: '', attachments: [attachment('image/heic', Buffer.from('heic'), null)] })

      const summary = await ingestMessages([photo], UID_VALIDITY, fake.deps)

      expect(fake.emails[0].classification).toBe('failed')
      expect(summary.refusalsRecorded).toBe(1)
      expect(fake.pos.map((row) => row.check_results?.failures[0].reason)).toEqual(['unsupported_format'])
    })

    // CONSTRAINT-30 / SEC-05. `check_results` is persisted and read back by the
    // review UI, so it must carry no production customer data.
    it('puts no filename, subject, sender or body text in the failures entry', async () => {
      const fake = recorder()
      const mixed = message({
        subject: 'PO 10042 attached',
        from: 'Acme Orders <orders@invalid.test>',
        bodyText: BODY_PO_TEXT,
        attachments: [
          attachment('image/jpeg', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'secret-customer.jpg'),
        ],
      })

      await ingestMessages([mixed], UID_VALIDITY, fake.deps)

      const recorded = JSON.stringify(fake.pos.map((row) => row.check_results))
      expect(recorded).not.toContain('secret-customer')
      expect(recorded).not.toContain('PO 10042')
      expect(recorded).not.toContain('orders@invalid.test')
      expect(recorded).not.toContain('totes')
    })
  })

  it('returns a zero summary for an empty batch without touching the data layer', async () => {
    const fake = recorder()

    const summary = await ingestMessages([], UID_VALIDITY, fake.deps)

    expect(summary).toEqual({
      messagesSeen: 0,
      emailsStaged: 0,
      alreadyStaged: 0,
      posStaged: 0,
      duplicatesFlagged: 0,
      refusalsRecorded: 0,
      committedUids: [],
      failedUids: [],
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
  const limits = readFileSync(path.join(__dirname, '..', 'limits.ts'), 'utf8')
  const messageModule = readFileSync(path.join(__dirname, '..', 'message.ts'), 'utf8')
  const run = readFileSync(path.join(__dirname, '..', 'run.ts'), 'utf8')

  it('imports no runtime value from the database or the Supabase client', () => {
    for (const moduleSource of [source, candidates, limits, messageModule, run]) {
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
