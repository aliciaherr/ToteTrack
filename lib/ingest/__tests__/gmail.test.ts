import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ImapConnectionError, IngestConfigError, MimeParseError } from '@/lib/errors'
import { fetchUnprocessedMail, readGmailImapConfig } from '../gmail'
import { canonicalMessageId, isSyntheticMessageId, standInMessageId } from '../identity'
import { parseMessage } from '../message'
import { createImapSession } from '../imap-session'
import {
  MAX_HEADER_BYTES,
  MAX_MESSAGES_PER_RUN,
  MAX_TOTAL_INGEST_BYTES,
} from '../limits.constants'
import type { GmailDeps, GmailImapConfig, ImapSession, InboundMessage } from '../types'

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

const STAGED_MESSAGE = mimeMessage(
  [
    'Message-ID: <already-staged@invalid.test>',
    'From: Acme Orders <orders@invalid.test>',
    'Subject: PO 10041 attached',
  ],
  'This one was staged on an earlier run.'
)

const NO_MESSAGE_ID = mimeMessage(
  ['From: Acme Orders <orders@invalid.test>', 'Subject: PO with no id'],
  'Body only.'
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
  /** Envelope `Message-ID`. `null` models a message whose header is absent. */
  messageId?: string | null
}

interface FakeSession {
  session: ImapSession
  close: ReturnType<typeof vi.fn>
  /** The watermark `fetchUnprocessedMail` actually asked for. */
  requestedUids: number[]
  /**
   * UIDs whose bytes were actually downloaded. **This is the H-01 assertion:**
   * a refused message must never appear here, because a cap applied after the
   * download does not protect memory at all.
   */
  fetchedUids: number[]
}

function sessionOf(...messages: FakeMessage[]): FakeSession {
  const close = vi.fn(async () => {})
  const requestedUids: number[] = []
  const fetchedUids: number[] = []
  const session: ImapSession = {
    listFrom(sinceUid: number) {
      requestedUids.push(sinceUid)
      return (async function* yieldDeclared() {
        for (const fake of messages) {
          yield {
            uid: fake.uid,
            declaredSize: fake.declaredSize ?? fake.source.length,
            // Canonicalised, exactly as `toDeclaredMessage` does it, so the
            // fake cannot hide an H-03-style spelling mismatch.
            messageId: fake.messageId ? canonicalMessageId(fake.messageId) : null,
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

function depsWith(session: ImapSession, overrides: Partial<GmailDeps> = {}): GmailDeps {
  return { config: FAKE_CONFIG, openSession: async () => session, ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseMessage', () => {
  it('returns the body text and one attachment for a MIME message carrying one PDF', async () => {
    const message = await parseMessage(Buffer.from(PDF_MESSAGE), 7)

    expect(message.messageId).toBe('po-10042@orders.invalid.test')
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

  // H-02. This used to throw, and the throw escaped the fetch loop and
  // discarded the entire batch — permanently, because nothing was staged, so
  // no message_id was written and every later run died on the same message.
  // Omitting the header is trivial from any MTA and routine in spam.
  it('stages a message with no Message-ID under a stand-in identity', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message = await parseMessage(Buffer.from(NO_MESSAGE_ID), 11)

    expect(message.messageId).toBe(standInMessageId(11))
    expect(isSyntheticMessageId(message.messageId)).toBe(true)
    // Readable, so it is staged *normally* — its body and any attachment stay
    // extractable. Only a message nothing could be read from is flagged.
    expect(message.rejection).toBeNull()
    expect(message.bodyText).toContain('Body only.')
    expect(JSON.stringify(consoleError.mock.calls)).toContain('stand-in identity')
  })

  // Still fatal with no UID: `parseMessage` is exported and callable without
  // one, and an identity cannot be invented from nothing.
  it('throws MimeParseError when there is neither a Message-ID nor a UID', async () => {
    const failure = parseMessage(Buffer.from(NO_MESSAGE_ID))
    await expect(failure).rejects.toThrow(MimeParseError)
    await expect(failure).rejects.toThrow(/Message-ID/)
  })

  it('bounds an over-long subject and from header at the boundary', async () => {
    const long = 'z'.repeat(MAX_HEADER_BYTES * 3)
    const bloated = mimeMessage(
      [
        'Message-ID: <bloated@orders.invalid.test>',
        `From: ${long} <orders@invalid.test>`,
        `Subject: ${long}`,
      ],
      'Body.'
    )

    const message = await parseMessage(Buffer.from(bloated), 12)

    // M-06: both reach `inbound_emails` as unbounded text otherwise.
    expect(Buffer.byteLength(message.subject ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    expect(Buffer.byteLength(message.from ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
  })
})

describe('fetchUnprocessedMail', () => {
  it('throws with the host and user, and without the app password, when auth fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps: GmailDeps = {
      config: FAKE_CONFIG,
      openSession: async () => {
        throw new Error('Invalid credentials (Failure) [AUTHENTICATIONFAILED]')
      },
    }

    const failure = fetchUnprocessedMail(new Set(), deps)
    await expect(failure).rejects.toThrow(ImapConnectionError)
    await expect(failure).rejects.toThrow(/imap\.invalid\.test/)
    await expect(failure).rejects.toThrow(/ingest-fixture@invalid\.test/)
    await expect(failure).rejects.toThrow(/GMAIL_IMAP_APP_PASSWORD/)

    // SEC-01: the app password must not reach the thrown message or any console
    // sink. Asserted across every argument of every `console.error` call,
    // following the precedent LoginForm.test.tsx:79 set for the login password.
    const error = (await failure.catch((caught: unknown) => caught)) as ImapConnectionError
    expect(error.message).not.toContain(FAKE_CONFIG.appPassword)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(FAKE_CONFIG.appPassword)
  })

  it('omits messages already present in processedIds and closes the session', async () => {
    const { session, close, fetchedUids } = sessionOf(
      { uid: 4, source: Buffer.from(PDF_MESSAGE), messageId: '<po-10042@orders.invalid.test>' },
      { uid: 9, source: Buffer.from(STAGED_MESSAGE), messageId: '<already-staged@invalid.test>' }
    )

    const messages = await fetchUnprocessedMail(
      // Canonical form, which is what the pipeline will have stored.
      new Set(['already-staged@invalid.test']),
      depsWith(session)
    )

    expect(messages.map((message) => message.messageId)).toEqual([
      'po-10042@orders.invalid.test',
    ])
    // Skipped from the listing, so its bytes were never transferred. The
    // previous version of this loop filtered after a full fetch and parse.
    expect(fetchedUids).toEqual([4])
    expect(close).toHaveBeenCalledOnce()
  })

  it('selects by UID watermark, defaulting to the whole mailbox', async () => {
    const whole = sessionOf()
    await fetchUnprocessedMail(new Set(), depsWith(whole.session))
    expect(whole.requestedUids).toEqual([1])

    const resumed = sessionOf()
    await fetchUnprocessedMail(new Set(), depsWith(resumed.session, { sinceUid: 512 }))
    expect(resumed.requestedUids).toEqual([512])
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

      const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

      // Never downloaded. A cap that fetches first protects nothing.
      expect(fetchedUids).toEqual([])
      expect(messages).toHaveLength(1)
      expect(messages[0].messageId).toBe('too-big@orders.invalid.test')
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

    it('still ingests a valid message sitting behind a refused one', async () => {
      const { session, fetchedUids } = sessionOf(
        {
          uid: 4,
          source: Buffer.from(PDF_MESSAGE),
          declaredSize: OVERSIZED,
          messageId: '<too-big@orders.invalid.test>',
        },
        { uid: 5, source: Buffer.from(PDF_MESSAGE), messageId: '<po-10042@orders.invalid.test>' }
      )

      const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

      // Only the valid one cost any bytes, and it parsed normally.
      expect(fetchedUids).toEqual([5])
      expect(messages).toHaveLength(2)
      expect(messages[0].rejection?.reason).toBe('message_too_large')
      expect(messages[1].rejection).toBeNull()
      expect(messages[1].attachments).toHaveLength(1)
    })

    // Each message fits the ceiling alone, so none is refused — but together
    // they exceed it, and the run must stop rather than hold them all.
    it('stops the run when the batch total would exceed the ceiling', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const twoThirds = Math.ceil(MAX_TOTAL_INGEST_BYTES * (2 / 3))
      const { session, fetchedUids } = sessionOf(
        { uid: 1, source: Buffer.from(PDF_MESSAGE), declaredSize: twoThirds, messageId: '<a@x.test>' },
        { uid: 2, source: Buffer.from(PDF_MESSAGE), declaredSize: twoThirds, messageId: '<b@x.test>' },
        { uid: 3, source: Buffer.from(PDF_MESSAGE), declaredSize: 128, messageId: '<c@x.test>' }
      )

      const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

      // The first fits; the second does not and stops the loop. The third is
      // small enough to have fitted, and is deliberately *not* taken ahead of
      // the second — the backlog drains in arrival order.
      expect(fetchedUids).toEqual([1])
      expect(messages).toHaveLength(1)
      // Nothing is staged for a deferred message: writing its row would write
      // the unique message_id and refuse a good PO forever.
      expect(messages[0].rejection).toBeNull()
      expect(JSON.stringify(consoleError.mock.calls)).toContain('byte budget reached')
    })

    // H-02 resolved this too: the refuse path could previously not stage a
    // message with no Message-ID at all and dropped it with a log line, while
    // the admit path threw. Both now take the one identity rule.
    it('stages a refused message that carries no Message-ID, under the UID stand-in', async () => {
      const { session, fetchedUids } = sessionOf({
        uid: 4,
        source: Buffer.from(PDF_MESSAGE),
        declaredSize: OVERSIZED,
        messageId: null,
      })

      const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

      expect(fetchedUids).toEqual([])
      expect(messages).toHaveLength(1)
      expect(messages[0].messageId).toBe(standInMessageId(4))
      expect(messages[0].rejection?.reason).toBe('message_too_large')
    })

    it('skips a message already staged under its stand-in identity', async () => {
      const { session, fetchedUids } = sessionOf({
        uid: 4,
        source: Buffer.from(PDF_MESSAGE),
        messageId: null,
      })

      const messages = await fetchUnprocessedMail(
        new Set([standInMessageId(4)]),
        depsWith(session)
      )

      // Stability is what makes the stand-in work as a processed marker: the
      // next run must recognise it rather than stage the message again.
      expect(messages).toEqual([])
      expect(fetchedUids).toEqual([])
    })
  })

  // H-03 and M-07, both through the **real** parser with no injected fake.
  // That gap is why both shipped: every loop test injected a parser, so
  // mailparser's own bracketing and the missing UID were never exercised
  // together with the pre-filter.
  describe('end to end through the real parser', () => {
    // Each case is the raw `Message-ID` header as a sender wrote it, which is
    // also what `imapflow` reports from ENVELOPE. `mailparser` balances and
    // brackets it, so the two layers see different spellings of one header —
    // the unbalanced pairs are the ones a matched-pair strip missed.
    const SENT_SPELLINGS = [
      'bare-po@orders.invalid.test',
      '<bare-po@orders.invalid.test>',
      '<bare-po@orders.invalid.test',
      'bare-po@orders.invalid.test>',
    ]

    it.each(SENT_SPELLINGS)(
      'skips a message sent with Message-ID %j on the second run',
      async (sentId) => {
        const fixture = {
          uid: 3,
          source: Buffer.from(
            mimeMessage(
              [`Message-ID: ${sentId}`, 'Subject: PO 10043'],
              'Please see the attached purchase order.',
              FAKE_PDF_BYTES
            )
          ),
          messageId: sentId,
        }

        const first = sessionOf(fixture)
        const firstRun = await fetchUnprocessedMail(new Set(), depsWith(first.session))

        expect(first.fetchedUids).toEqual([3])
        expect(firstRun).toHaveLength(1)

        // Exactly what the pipeline would have stored, fed back as the next
        // run's processed set.
        const stored = new Set(firstRun.map((message) => message.messageId))
        const second = sessionOf(fixture)
        const secondRun = await fetchUnprocessedMail(stored, depsWith(second.session))

        // Without one canonical form the listing key and the stored key never
        // match, so the message is re-downloaded on every run forever — and
        // 200 of them fill MAX_MESSAGES_PER_RUN, starving the real mail behind
        // them. Permanent denial of ingestion from one ordinary header.
        expect(secondRun).toEqual([])
        expect(second.fetchedUids).toEqual([])
      }
    )

    it('derives one identity from every spelling of the same sent header', async () => {
      const identities = new Set<string>()
      for (const sentId of SENT_SPELLINGS) {
        const source = Buffer.from(
          mimeMessage([`Message-ID: ${sentId}`, 'Subject: PO 10043'], 'Body.')
        )
        const { session } = sessionOf({ uid: 3, source, messageId: sentId })
        const [message] = await fetchUnprocessedMail(new Set(), depsWith(session))
        identities.add(message.messageId)
      }

      expect(identities.size).toBe(1)
      expect([...identities][0]).toBe('bare-po@orders.invalid.test')
    })

    // M-07: the production default passed no UID, so `identityOf` threw for
    // every unlabelled message and it was staged `unparseable` with its
    // attachments discarded — the stranding the H-02 split exists to prevent.
    it('stages an unlabelled message normally, keeping its attachment', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { session, fetchedUids } = sessionOf({
        uid: 8,
        source: Buffer.from(
          mimeMessage(['Subject: PO 10044'], 'Attached.', FAKE_PDF_BYTES)
        ),
        messageId: null,
      })

      const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

      expect(fetchedUids).toEqual([8])
      expect(messages).toHaveLength(1)
      expect(messages[0].messageId).toBe(standInMessageId(8))
      // Readable, so it is NOT flagged — and its PO is still extractable.
      expect(messages[0].rejection).toBeNull()
      expect(messages[0].attachments).toHaveLength(1)
      expect(messages[0].attachments[0].bytes.equals(FAKE_PDF_BYTES)).toBe(true)
      expect(JSON.stringify(consoleError.mock.calls)).toContain('stand-in identity')
    })

    it('keeps the stand-in identity stable across two runs of that message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const fixture = {
        uid: 8,
        source: Buffer.from(mimeMessage(['Subject: PO 10044'], 'Attached.')),
        messageId: null,
      }

      const firstRun = await fetchUnprocessedMail(new Set(), depsWith(sessionOf(fixture).session))
      const second = sessionOf(fixture)
      const secondRun = await fetchUnprocessedMail(
        new Set(firstRun.map((message) => message.messageId)),
        depsWith(second.session)
      )

      expect(secondRun).toEqual([])
      expect(second.fetchedUids).toEqual([])
    })

    // M-08 through the whole path, since the refuse and unparseable paths
    // bypass mailparser entirely and so cannot rely on its bracketing.
    it('refuses to store a sender-forged reserved identity', async () => {
      const forged = sessionOf({
        uid: 4,
        source: Buffer.from(
          mimeMessage(['Message-ID: ingest-uid:4', 'Subject: PO 10045'], 'Body.')
        ),
        messageId: 'ingest-uid:4',
      })

      const messages = await fetchUnprocessedMail(new Set(), depsWith(forged.session))

      // A sender must never be able to occupy an identity this code assigns.
      expect(messages[0].messageId).not.toBe(standInMessageId(4))
      expect(messages[0].messageId.startsWith('ingest-claimed:')).toBe(true)
    })
  })

  // H-02. One message that cannot be staged used to end the run, discard
  // everything already parsed behind it, and — because nothing was staged and
  // so no message_id was written — do it again on every subsequent run.
  describe('a message that cannot be parsed', () => {
    function parserThatFailsOn(badUid: number) {
      return async (raw: Buffer): Promise<InboundMessage> => {
        if (raw.toString().includes(`uid-${badUid}`)) throw new MimeParseError('malformed', badUid)
        return parseMessage(raw)
      }
    }

    it('keeps the run going and still stages the valid POs behind it', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      // The unparseable one is deliberately FIRST, which is the case that used
      // to lose the whole batch.
      const { session, fetchedUids } = sessionOf(
        { uid: 1, source: Buffer.from('uid-1 garbage'), messageId: null },
        { uid: 2, source: Buffer.from(PDF_MESSAGE), messageId: '<po-10042@orders.invalid.test>' }
      )

      const messages = await fetchUnprocessedMail(
        new Set(),
        depsWith(session, { parseRaw: parserThatFailsOn(1) })
      )

      expect(fetchedUids).toEqual([1, 2])
      expect(messages).toHaveLength(2)
      // The unreadable one is staged for review under its stand-in identity,
      // so it is marked processed and does not come back forever.
      expect(messages[0].messageId).toBe(standInMessageId(1))
      expect(messages[0].rejection).toEqual({
        check: 'ingest_limit',
        reason: 'unparseable',
        part: 'message',
      })
      // And the real purchase order behind it survived.
      expect(messages[1].messageId).toBe('po-10042@orders.invalid.test')
      expect(messages[1].rejection).toBeNull()
      expect(messages[1].attachments).toHaveLength(1)
      expect(JSON.stringify(consoleError.mock.calls)).toContain('could not be parsed')
    })

    it('derives the same stand-in identity on a second run of the same message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const fixture = { uid: 7, source: Buffer.from('uid-7 garbage'), messageId: null }

      const first = await fetchUnprocessedMail(
        new Set(),
        depsWith(sessionOf(fixture).session, { parseRaw: parserThatFailsOn(7) })
      )
      const second = await fetchUnprocessedMail(
        new Set(),
        depsWith(sessionOf(fixture).session, { parseRaw: parserThatFailsOn(7) })
      )

      expect(second[0].messageId).toBe(first[0].messageId)
      expect(first[0].messageId).toBe(standInMessageId(7))
    })

    // A dead socket is not one message's fault. Swallowing it would stage
    // every remaining message as unparseable and mark real POs processed
    // without ever having read them.
    it('re-raises a connection failure instead of recording it as unparseable', async () => {
      const { session } = sessionOf({ uid: 1, source: Buffer.from(PDF_MESSAGE), messageId: null })
      session.fetchSource = async () => {
        throw new ImapConnectionError('imap.invalid.test', 'ingest-fixture@invalid.test', 'socket gone')
      }

      const failure = fetchUnprocessedMail(new Set(), depsWith(session))

      await expect(failure).rejects.toThrow(ImapConnectionError)
    })
  })

  // M-05: the byte budget bounds memory but not count — 60MB of two-kilobyte
  // emails is roughly thirty thousand rows and, from Task 98, that many
  // billed extraction calls.
  it('stops at the message-count cap and leaves the rest for the next run', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tiny = Array.from({ length: MAX_MESSAGES_PER_RUN + 5 }, (_, index) => ({
      uid: index + 1,
      source: Buffer.from(PDF_MESSAGE),
      declaredSize: 2048,
      messageId: `<po-${index}@orders.invalid.test>`,
    }))
    const { session, fetchedUids } = sessionOf(...tiny)

    const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

    expect(messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(fetchedUids).toHaveLength(MAX_MESSAGES_PER_RUN)
    // A defer, not a refusal: nothing is staged for the remainder, so they are
    // still in the mailbox with a full budget waiting next run.
    expect(JSON.stringify(consoleError.mock.calls)).toContain('message-count cap reached')
  })

  // L-13. Fails closed: the declared size is the whole basis of the byte cap.
  it('refuses a message whose declared size is not a usable number', async () => {
    const { session, fetchedUids } = sessionOf({
      uid: 4,
      source: Buffer.from(PDF_MESSAGE),
      declaredSize: Number.NaN,
      messageId: '<no-size@orders.invalid.test>',
    })

    const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

    // Without the guard every comparison against NaN is false, so the verdict
    // would be `admit` and `bytesAdmitted += NaN` would then disable the
    // budget for every remaining message in the run.
    expect(fetchedUids).toEqual([])
    expect(messages[0].rejection).toEqual({
      check: 'ingest_limit',
      reason: 'size_not_declared',
      part: 'message',
      limit: MAX_TOTAL_INGEST_BYTES,
      unit: 'bytes',
    })
  })

  // L-14: a TypeScript `number` is not a runtime check, and Task 102 will
  // supply this value from persisted state.
  it('rejects a watermark that is not a usable IMAP UID', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const failure = fetchUnprocessedMail(
        new Set(),
        depsWith(sessionOf().session, { sinceUid: bad })
      )
      await expect(failure).rejects.toThrow(IngestConfigError)
      await expect(failure).rejects.toThrow(/sinceUid/)
    }
  })

  // EH-01: a logout failure after a successful read loses nothing, so it is
  // reported rather than rethrown — but it is never swallowed in silence, and
  // the log line carries host and user only.
  it('reports a logout failure without discarding the messages it already read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session } = sessionOf({ uid: 4, source: Buffer.from(PDF_MESSAGE) })
    session.close = async () => {
      throw new Error('socket already gone')
    }

    const messages = await fetchUnprocessedMail(new Set(), depsWith(session))

    expect(messages).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('IMAP logout from imap.invalid.test'),
      expect.objectContaining({ cause: expect.any(Error) })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(FAKE_CONFIG.appPassword)
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
