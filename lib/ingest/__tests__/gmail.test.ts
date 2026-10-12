import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ImapConnectionError, IngestConfigError, MimeParseError } from '@/lib/errors'
import { closeMailbox, collectUnprocessed, openMailbox, readGmailImapConfig } from '../gmail'
import { boundDate, boundHeader, parseMessage } from '../message'
import { createImapSession } from '../imap-session'
import {
  MAX_HEADER_BYTES,
  MAX_MESSAGES_PER_RUN,
  MAX_TOTAL_INGEST_BYTES,
} from '../limits.constants'
import type {
  AdmissionWindow,
  GmailDeps,
  GmailImapConfig,
  ImapSession,
  InboundMessage,
} from '../types'

// No live connection anywhere in this file. `openSession` is a required field
// on `GmailDeps` with no default, so every test here injects a fake session and
// the real `createImapSession` is only ever referenced, never called.
//
// Every credential below is obviously fake and uses the reserved `.test` TLD,
// which can never resolve. The app-password placeholder says what it is, so no
// reader has to wonder whether a real one leaked (SEC-01).
const FAKE_CONFIG: GmailImapConfig = {
  host: 'imap.invalid.test',
  user: 'ingest-fixture@invalid.test',
  appPassword: 'not-a-real-app-password',
}

// A few bytes that look like a PDF without being one. Built in memory rather
// than committed as a file: `*.pdf` is gitignored repo-wide (CONSTRAINT-30 /
// SEC-07), so a fixture file on disk would be untracked and the suite would
// pass here and fail on a fresh clone.
const FAKE_PDF_BYTES = Buffer.from('%PDF-1.4\nfake purchase order fixture\n%%EOF\n')

function mimeMessage(headers: string[], bodyText: string, attachment?: Buffer): string {
  const parts = [
    ...headers,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="bound42"',
    '',
    '--bound42',
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
    '',
  ]
  if (attachment) {
    parts.push(
      '--bound42',
      'Content-Type: application/pdf; name="po-10042.pdf"',
      'Content-Disposition: attachment; filename="po-10042.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      attachment.toString('base64'),
      ''
    )
  }
  parts.push('--bound42--', '')
  return parts.join('\r\n')
}

const PDF_MESSAGE = mimeMessage(
  [
    'Message-ID: <po-10042@orders.invalid.test>',
    'From: Acme Orders <orders@invalid.test>',
    'To: ingest-fixture@invalid.test',
    'Subject: PO 10042 attached',
    'Date: Wed, 07 Oct 2026 09:15:00 -0500',
  ],
  'Please see the attached purchase order.',
  FAKE_PDF_BYTES
)

const NO_MESSAGE_ID = mimeMessage(
  ['From: Acme Orders <orders@invalid.test>', 'Subject: PO with no id'],
  'Body only.',
  FAKE_PDF_BYTES
)

/**
 * One message in the fake mailbox. `declaredSize` is separate from the actual
 * source precisely so a multi-megabyte *declared* size can be tested against
 * the byte budget without allocating a multi-megabyte buffer — which is also
 * the real shape of the thing: IMAP declares a size before any bytes move.
 */
interface FakeMessage {
  uid: number
  source: Buffer
  /** Declared size. Defaults to the real source length. */
  declaredSize?: number
  /** Envelope `Message-ID` label. Defaults to absent. */
  messageId?: string | null
}

interface FakeSession {
  session: ImapSession
  close: ReturnType<typeof vi.fn>
  /** The `sinceUid` the reader actually asked the server for. */
  requestedUids: number[]
  /**
   * UIDs whose bytes were actually downloaded. **This is the H-01 assertion:**
   * a refused or already-staged message must never appear here.
   */
  fetchedUids: number[]
}

const FAKE_UID_VALIDITY = 7

/**
 * A fake mailbox that, like a real IMAP server, lists every message it is
 * given — including ones below `sinceUid`, which is how `UID FETCH n:*`
 * behaves when `n` is above every UID.
 */
function sessionOf(...messages: FakeMessage[]): FakeSession {
  const close = vi.fn(async () => {})
  const requestedUids: number[] = []
  const fetchedUids: number[] = []
  const session: ImapSession = {
    uidValidity: FAKE_UID_VALIDITY,
    listFrom(sinceUid: number) {
      requestedUids.push(sinceUid)
      return (async function* yieldDeclared() {
        for (const fake of messages) {
          yield {
            uid: fake.uid,
            declaredSize: fake.declaredSize ?? fake.source.length,
            messageId: fake.messageId ?? null,
            from: null,
            subject: null,
            receivedAt: null,
          }
        }
      })()
    },
    async fetchSource(uid: number) {
      fetchedUids.push(uid)
      const found = messages.find((fake) => fake.uid === uid)
      if (!found) throw new Error(`fake mailbox has no UID ${uid}`)
      return found.source
    },
    close,
  }
  return { session, close, requestedUids, fetchedUids }
}

function windowOf(watermark = 0, staged: number[] = []): AdmissionWindow {
  return { watermark, stagedUids: new Set(staged) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseMessage', () => {
  it('returns the UID, body text and one attachment for a MIME message carrying one PDF', async () => {
    const message = await parseMessage(Buffer.from(PDF_MESSAGE), 7)

    expect(message.uid).toBe(7)
    expect(message.messageId).toBe('<po-10042@orders.invalid.test>')
    expect(message.from).toContain('orders@invalid.test')
    expect(message.subject).toBe('PO 10042 attached')
    expect(message.receivedAt).toBeInstanceOf(Date)
    expect(message.bodyText).toContain('attached purchase order')

    expect(message.attachments).toHaveLength(1)
    const [attachment] = message.attachments
    expect(attachment.filename).toBe('po-10042.pdf')
    expect(attachment.mimeType).toBe('application/pdf')
    expect(attachment.bytes.equals(FAKE_PDF_BYTES)).toBe(true)
  })

  // H-02 / M-07: a missing header once threw and lost the batch. The UID is
  // the marker now, so the message is simply staged with no label.
  it('parses a message with no Message-ID normally, keeping its attachment', async () => {
    const message = await parseMessage(Buffer.from(NO_MESSAGE_ID), 11)

    expect(message.uid).toBe(11)
    expect(message.messageId).toBeNull()
    expect(message.rejection).toBeNull()
    expect(message.attachments).toHaveLength(1)
  })

  it('strips a NUL byte a sender encoded into the subject', async () => {
    const poisoned = mimeMessage(
      ['Message-ID: <nul@orders.invalid.test>', 'Subject: =?utf-8?Q?PO=0010042?='],
      'Body.'
    )

    const message = await parseMessage(Buffer.from(poisoned), 13)

    expect(message.subject).toBe('PO10042')
  })

  it('throws MimeParseError naming the UID when the parser fails', async () => {
    const failure = parseMessage(null as unknown as Buffer, 12)
    await expect(failure).rejects.toThrow(MimeParseError)
  })

  it('bounds an over-long subject and from header at the boundary', async () => {
    const long = 'z'.repeat(MAX_HEADER_BYTES * 3)
    const bloated = mimeMessage(
      [
        `Message-ID: <${long}@orders.invalid.test>`,
        `From: ${long} <orders@invalid.test>`,
        `Subject: ${long}`,
      ],
      'Body.'
    )

    const message = await parseMessage(Buffer.from(bloated), 12)

    // M-06: sender-controlled display text, bounded before it is stored.
    for (const header of [message.messageId, message.subject, message.from]) {
      expect(Buffer.byteLength(header ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    }
  })
})

describe('boundHeader', () => {
  it('passes through a null or an ordinary header unchanged', () => {
    expect(boundHeader(null)).toBeNull()
    expect(boundHeader('PO 10042 attached')).toBe('PO 10042 attached')
  })

  it('bounds an over-long header by bytes, not characters', () => {
    // A four-byte character repeated: a character count would not be enough.
    const wide = '\u{1F4E6}'.repeat(MAX_HEADER_BYTES)

    const bounded = boundHeader(wide) as string

    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    // Shortened by whole characters, so no multi-byte sequence was split.
    expect(bounded).not.toContain('�')
  })
})

describe('boundHeader control characters', () => {
  // HIGH-02: Postgres cannot store U+0000, so a header carrying one failed the
  // insert on every run and pinned the watermark forever.
  it('strips NUL and other control characters, keeping tab', () => {
    expect(boundHeader('PO\u000010042\u0007\r\n\u007F\tattached')).toBe('PO10042\tattached')
  })
})

describe('boundDate', () => {
  it('keeps a plausible date', () => {
    const date = new Date('2026-10-07T14:15:00.000Z')
    expect(boundDate(date)).toBe(date)
  })

  // HIGH-02: a date Postgres refuses would fail the insert on every run.
  it('returns null for a missing, unparseable or implausible date', () => {
    expect(boundDate(null)).toBeNull()
    expect(boundDate(new Date('not a date'))).toBeNull()
    expect(boundDate(new Date(-8_000_000_000_000_000))).toBeNull()
    expect(boundDate(new Date(Date.UTC(1969, 11, 31)))).toBeNull()
  })
})

describe('openMailbox', () => {
  it('throws with the host and user, and without the app password, when auth fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps: GmailDeps = {
      config: FAKE_CONFIG,
      openSession: async () => {
        throw new Error('Invalid credentials (Failure) [AUTHENTICATIONFAILED]')
      },
    }

    const failure = openMailbox(deps)
    await expect(failure).rejects.toThrow(ImapConnectionError)
    await expect(failure).rejects.toThrow(/imap\.invalid\.test/)
    await expect(failure).rejects.toThrow(/ingest-fixture@invalid\.test/)
    await expect(failure).rejects.toThrow(/GMAIL_IMAP_APP_PASSWORD/)

    // SEC-01: the app password must not reach the thrown message or any console
    // sink, across every argument of every `console.error` call.
    const error = (await failure.catch((caught: unknown) => caught)) as ImapConnectionError
    expect(error.message).not.toContain(FAKE_CONFIG.appPassword)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(FAKE_CONFIG.appPassword)
  })

  it('returns the session the factory opened', async () => {
    const { session } = sessionOf()
    await expect(openMailbox({ config: FAKE_CONFIG, openSession: async () => session })).resolves.toBe(session)
  })
})

describe('closeMailbox', () => {
  it('closes the session', async () => {
    const { session, close } = sessionOf()
    await closeMailbox(session, FAKE_CONFIG)
    expect(close).toHaveBeenCalledOnce()
  })

  // EH-01: a logout failure loses nothing already read, so it is reported
  // rather than rethrown — never swallowed, and logged with host and user only.
  it('reports a logout failure without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session } = sessionOf()
    session.close = async () => {
      throw new Error('socket already gone')
    }

    await expect(closeMailbox(session, FAKE_CONFIG)).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('IMAP logout from imap.invalid.test'),
      expect.objectContaining({ cause: expect.any(Error) })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(FAKE_CONFIG.appPassword)
  })
})

describe('collectUnprocessed', () => {
  it('lists from one above the watermark and admits by UID alone', async () => {
    const { session, requestedUids, fetchedUids } = sessionOf(
      { uid: 5, source: Buffer.from(PDF_MESSAGE) },
      { uid: 6, source: Buffer.from(NO_MESSAGE_ID) }
    )

    const collected = await collectUnprocessed(session, windowOf(4))

    expect(requestedUids).toEqual([5])
    expect(fetchedUids).toEqual([5, 6])
    expect(collected.messages.map((message) => message.uid)).toEqual([5, 6])
    expect(collected).toMatchObject({ alreadyStagedUids: [], deferredUids: [], rejectedUids: [] })
  })

  // The crash-between-staging-and-advance case: the UID is listed again, but
  // its bytes are never downloaded a second time.
  it('skips a UID already staged above the watermark without fetching it', async () => {
    const { session, fetchedUids } = sessionOf(
      { uid: 5, source: Buffer.from(PDF_MESSAGE) },
      { uid: 6, source: Buffer.from(PDF_MESSAGE) }
    )

    const collected = await collectUnprocessed(session, windowOf(4, [5]))

    expect(fetchedUids).toEqual([6])
    expect(collected.alreadyStagedUids).toEqual([5])
    expect(collected.messages.map((message) => message.uid)).toEqual([6])
  })

  // `UID FETCH n:*` returns the newest message even when n is above every UID.
  it('ignores a listed UID at or below the watermark without fetching it', async () => {
    const { session, fetchedUids } = sessionOf({ uid: 4, source: Buffer.from(PDF_MESSAGE) })

    const collected = await collectUnprocessed(session, windowOf(4))

    expect(fetchedUids).toEqual([])
    expect(collected.messages).toEqual([])
    expect(collected.alreadyStagedUids).toEqual([])
  })

  // Architecture rule 2: nothing branches on the label. Two messages that
  // share one Message-ID are two messages.
  it('collects two messages that share one Message-ID', async () => {
    const shared = '<same@orders.invalid.test>'
    const { session, fetchedUids } = sessionOf(
      { uid: 1, source: Buffer.from(PDF_MESSAGE), messageId: shared },
      { uid: 2, source: Buffer.from(PDF_MESSAGE), messageId: shared }
    )

    const collected = await collectUnprocessed(session, windowOf())

    expect(fetchedUids).toEqual([1, 2])
    expect(collected.messages.map((message) => message.uid)).toEqual([1, 2])
  })

  // Architecture rule 3: the parsed UID is checked against the window again.
  it('post-parse re-check rejects a message whose UID is at or below the watermark', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session } = sessionOf({ uid: 9, source: Buffer.from(PDF_MESSAGE) })
    const parseRaw = async (raw: Buffer) => parseMessage(raw, 3)

    const collected = await collectUnprocessed(session, windowOf(4), { parseRaw })

    expect(collected.messages).toEqual([])
    expect(collected.rejectedUids).toEqual([9])
    expect(JSON.stringify(consoleError.mock.calls)).toContain('post-parse UID re-check')
  })

  // H-01. The declared size is the only thing these tests measure against,
  // because it is the only size known before the bytes move.
  describe('the invocation byte budget', () => {
    const OVERSIZED = MAX_TOTAL_INGEST_BYTES + 1

    it('refuses a message larger than the ceiling without fetching its bytes', async () => {
      const { session, fetchedUids } = sessionOf({
        uid: 4,
        source: Buffer.from(PDF_MESSAGE),
        declaredSize: OVERSIZED,
        messageId: '<too-big@orders.invalid.test>',
      })

      const { messages } = await collectUnprocessed(session, windowOf())

      // Never downloaded. A cap that fetches first protects nothing.
      expect(fetchedUids).toEqual([])
      expect(messages).toHaveLength(1)
      expect(messages[0].uid).toBe(4)
      expect(messages[0].messageId).toBe('<too-big@orders.invalid.test>')
      expect(messages[0].attachments).toEqual([])
      expect(messages[0].bodyText).toBe('')
      expect(messages[0].rejection).toEqual({
        check: 'ingest_limit',
        reason: 'message_too_large',
        part: 'message',
        measured: OVERSIZED,
        limit: MAX_TOTAL_INGEST_BYTES,
        unit: 'bytes',
      })
    })

    it('stages a refused message that carries no Message-ID, by its UID', async () => {
      const { session } = sessionOf({ uid: 4, source: Buffer.from(PDF_MESSAGE), declaredSize: OVERSIZED })

      const { messages } = await collectUnprocessed(session, windowOf())

      expect(messages[0]).toMatchObject({ uid: 4, messageId: null })
      expect(messages[0].rejection?.reason).toBe('message_too_large')
    })

    it('still ingests a valid message sitting behind a refused one', async () => {
      const { session, fetchedUids } = sessionOf(
        { uid: 4, source: Buffer.from(PDF_MESSAGE), declaredSize: OVERSIZED },
        { uid: 5, source: Buffer.from(PDF_MESSAGE) }
      )

      const { messages } = await collectUnprocessed(session, windowOf())

      expect(fetchedUids).toEqual([5])
      expect(messages).toHaveLength(2)
      expect(messages[0].rejection?.reason).toBe('message_too_large')
      expect(messages[1].rejection).toBeNull()
      expect(messages[1].attachments).toHaveLength(1)
    })

    // Each message fits the ceiling alone, so none is refused — but together
    // they exceed it, and the run must stop rather than hold them all.
    it('stops the run when the batch total would exceed the ceiling, reporting the deferral', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const twoThirds = Math.ceil(MAX_TOTAL_INGEST_BYTES * (2 / 3))
      const { session, fetchedUids } = sessionOf(
        { uid: 1, source: Buffer.from(PDF_MESSAGE), declaredSize: twoThirds },
        { uid: 2, source: Buffer.from(PDF_MESSAGE), declaredSize: twoThirds },
        { uid: 3, source: Buffer.from(PDF_MESSAGE), declaredSize: 128 }
      )

      const collected = await collectUnprocessed(session, windowOf())

      // The third is small enough to have fitted, and is deliberately *not*
      // taken ahead of the second — the backlog drains in arrival order.
      expect(fetchedUids).toEqual([1])
      expect(collected.messages.map((message) => message.uid)).toEqual([1])
      // Nothing is staged for a deferred message; its UID halts the watermark.
      expect(collected.deferredUids).toEqual([2])
      expect(JSON.stringify(consoleError.mock.calls)).toContain('byte budget reached')
    })

    // L-13. Fails closed: the declared size is the whole basis of the byte cap.
    it('refuses a message whose declared size is not a usable number', async () => {
      const { session, fetchedUids } = sessionOf({
        uid: 4,
        source: Buffer.from(PDF_MESSAGE),
        declaredSize: Number.NaN,
      })

      const { messages } = await collectUnprocessed(session, windowOf())

      expect(fetchedUids).toEqual([])
      expect(messages[0].rejection).toEqual({
        check: 'ingest_limit',
        reason: 'size_not_declared',
        part: 'message',
        limit: MAX_TOTAL_INGEST_BYTES,
        unit: 'bytes',
      })
    })
  })

  // H-02. One message that cannot be parsed must not end the run.
  describe('a message that cannot be parsed', () => {
    function parserThatFailsOn(badUid: number) {
      return async (raw: Buffer, uid: number): Promise<InboundMessage> => {
        if (uid === badUid) throw new MimeParseError('malformed', badUid)
        return parseMessage(raw, uid)
      }
    }

    it('keeps the run going and still collects the valid POs behind it', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      // The unparseable one is deliberately FIRST, which is the case that used
      // to lose the whole batch.
      const { session, fetchedUids } = sessionOf(
        { uid: 1, source: Buffer.from('garbage') },
        { uid: 2, source: Buffer.from(PDF_MESSAGE) }
      )

      const { messages } = await collectUnprocessed(session, windowOf(), {
        parseRaw: parserThatFailsOn(1),
      })

      expect(fetchedUids).toEqual([1, 2])
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({
        uid: 1,
        rejection: { check: 'ingest_limit', reason: 'unparseable', part: 'message' },
      })
      expect(messages[1]).toMatchObject({ uid: 2, rejection: null })
      expect(messages[1].attachments).toHaveLength(1)
      expect(JSON.stringify(consoleError.mock.calls)).toContain('could not be parsed')
    })

    // A dead socket is not one message's fault. Swallowing it would stage
    // every remaining message as unparseable.
    it('re-raises a connection failure instead of recording it as unparseable', async () => {
      const { session } = sessionOf({ uid: 1, source: Buffer.from(PDF_MESSAGE) })
      session.fetchSource = async () => {
        throw new ImapConnectionError('imap.invalid.test', 'ingest-fixture@invalid.test', 'socket gone')
      }

      await expect(collectUnprocessed(session, windowOf())).rejects.toThrow(ImapConnectionError)
    })
  })

  // M-05: the byte budget bounds memory but not count.
  it('stops at the message-count cap and reports the next UID deferred', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tiny = Array.from({ length: MAX_MESSAGES_PER_RUN + 5 }, (_, index) => ({
      uid: index + 1,
      source: Buffer.from(PDF_MESSAGE),
      declaredSize: 2048,
    }))
    const { session, fetchedUids } = sessionOf(...tiny)

    const collected = await collectUnprocessed(session, windowOf())

    expect(collected.messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(fetchedUids).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(collected.deferredUids).toEqual([MAX_MESSAGES_PER_RUN + 1])
    expect(JSON.stringify(consoleError.mock.calls)).toContain('message-count cap reached')
  })

  // L-14: the watermark is read back from persisted state and interpolated
  // into the IMAP fetch range, so it is validated rather than trusted.
  it('rejects a watermark that does not yield a usable IMAP UID', async () => {
    for (const bad of [-1, 0.5, Number.NaN]) {
      const failure = collectUnprocessed(sessionOf().session, windowOf(bad))
      await expect(failure).rejects.toThrow(IngestConfigError)
      await expect(failure).rejects.toThrow(/sinceUid/)
    }
  })
})

describe('readGmailImapConfig', () => {
  const VALID_ENV = {
    GMAIL_IMAP_USER: 'ingest-fixture@invalid.test',
    GMAIL_IMAP_HOST: 'imap.invalid.test',
    GMAIL_IMAP_APP_PASSWORD: 'not-a-real-app-password',
  }

  it('reads all three credentials from the supplied environment', () => {
    expect(readGmailImapConfig({ ...VALID_ENV, ADMIN_EMAIL: 'login@invalid.test' })).toEqual({
      host: 'imap.invalid.test',
      user: 'ingest-fixture@invalid.test',
      appPassword: 'not-a-real-app-password',
    })
  })

  it('throws IngestConfigError naming the variable that is missing', () => {
    const env = { ...VALID_ENV, GMAIL_IMAP_APP_PASSWORD: '  ' }
    expect(() => readGmailImapConfig(env)).toThrow(IngestConfigError)
    expect(() => readGmailImapConfig(env)).toThrow(/GMAIL_IMAP_APP_PASSWORD is missing or empty/)
  })

  // The startup guard. `ADMIN_EMAIL` is a live Supabase Auth credential
  // (CONSTRAINT-04), so ingestion pointed at it would read the sign-in mailbox.
  it('throws when GMAIL_IMAP_USER names the same mailbox as ADMIN_EMAIL', () => {
    const env = { ...VALID_ENV, ADMIN_EMAIL: 'ingest-fixture@invalid.test' }
    expect(() => readGmailImapConfig(env)).toThrow(IngestConfigError)
    expect(() => readGmailImapConfig(env)).toThrow(/GMAIL_IMAP_USER/)
    expect(() => readGmailImapConfig(env)).toThrow(/ADMIN_EMAIL/)
    expect(() => readGmailImapConfig(env)).toThrow(/CONSTRAINT-04/)
  })

  it('catches the collision when the two addresses differ only in case or padding', () => {
    const env = { ...VALID_ENV, ADMIN_EMAIL: '  Ingest-Fixture@Invalid.TEST ' }
    expect(() => readGmailImapConfig(env)).toThrow(IngestConfigError)
  })

  // Neither address is interpolated into the message: CONSTRAINT-04 requires
  // the production ADMIN_EMAIL to stay out of every file, log sinks included.
  it('does not echo either address into the collision message', () => {
    const env = { ...VALID_ENV, ADMIN_EMAIL: 'ingest-fixture@invalid.test' }
    expect(() => readGmailImapConfig(env)).not.toThrow(/invalid\.test/)
  })
})

// Asserted against the source rather than against behaviour, because these are
// claims about what the module may not contain. A DB or storage import is what
// would make this module untestable without a database, and the whole Task 96 /
// Task 97 split exists to keep it out.
describe('gmail.ts source constraints', () => {
  const source = readFileSync(path.join(__dirname, '..', 'gmail.ts'), 'utf8')

  it('imports nothing from the database or storage layer', () => {
    expect(source).not.toMatch(/from '@\/db/)
    expect(source).not.toMatch(/from '@\/lib\/supabase/)
  })

  it('reads no credential off process.env directly and logs nothing', () => {
    // Credentials arrive through the `env` parameter of `readGmailImapConfig`,
    // which is what lets a test describe an environment without mutating the
    // real one. A direct `process.env.GMAIL_…` read would bypass the guards.
    expect(source).not.toMatch(/process\.env\.GMAIL_/)
    expect(source).not.toContain('console.log')
  })

  it('exports the production session factory without using it as a default', () => {
    expect(createImapSession).toBeTypeOf('function')
    expect(source).not.toMatch(/openSession\s*\?\?\s*createImapSession/)
  })
})

// The H-01 regression guard, asserted against the source because it is a claim
// about what the listing query may not ask for. `listFrom` requesting `source`
// would hand back every attachment byte before any cap could measure it, which
// is exactly the vulnerability — and it would still pass every behavioural
// test above, because the fake session cannot reproduce it.
describe('imap-session.ts listing constraints', () => {
  // Comments stripped before asserting: the module's own documentation
  // discusses `source: true` at length, and matching prose would make this
  // guard pass or fail on the wording rather than on the query.
  const code = readFileSync(path.join(__dirname, '..', 'imap-session.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\n]*\/\/.*$/gm, '')

  it('asks the listing for size and envelope only, never for message source', () => {
    const listingQuery = code.slice(code.indexOf('listFrom'), code.indexOf('fetchSource'))
    expect(listingQuery).toContain('size: true')
    expect(listingQuery).toContain('envelope: true')
    expect(listingQuery).not.toContain('source: true')
  })

  it('transfers message bytes from exactly one call', () => {
    expect(code.match(/source: true/g)).toHaveLength(1)
  })
})
