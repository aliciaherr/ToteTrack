import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ImapConnectionError, IngestConfigError, MimeParseError } from '@/lib/errors'
import {
  createImapSession,
  fetchUnprocessedMail,
  parseMessage,
  readGmailImapConfig,
} from '../gmail'
import type { GmailDeps, GmailImapConfig, ImapSession, RawImapMessage } from '../types'

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

interface FakeSession {
  session: ImapSession
  close: ReturnType<typeof vi.fn>
  /** The watermark `fetchUnprocessedMail` actually asked for. */
  requestedUids: number[]
}

function sessionOf(...raws: RawImapMessage[]): FakeSession {
  const close = vi.fn(async () => {})
  const requestedUids: number[] = []
  const session: ImapSession = {
    fetchFrom(sinceUid: number) {
      requestedUids.push(sinceUid)
      return (async function* yieldRaws() {
        for (const raw of raws) yield raw
      })()
    },
    close,
  }
  return { session, close, requestedUids }
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

  // The header is the dedupe key and the processed marker that replaces the
  // `\Seen` flag (Task 95), so a message without one cannot be staged under a
  // generated id — it has to fail loudly.
  it('throws MimeParseError naming the UID when the Message-ID header is absent', async () => {
    const failure = parseMessage(Buffer.from(NO_MESSAGE_ID), 11)
    await expect(failure).rejects.toThrow(MimeParseError)
    await expect(failure).rejects.toThrow(/UID 11/)
    await expect(failure).rejects.toThrow(/Message-ID/)
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
    const { session, close } = sessionOf(
      { uid: 4, source: Buffer.from(PDF_MESSAGE) },
      { uid: 9, source: Buffer.from(STAGED_MESSAGE) }
    )

    const messages = await fetchUnprocessedMail(
      new Set(['<already-staged@invalid.test>']),
      depsWith(session)
    )

    expect(messages.map((message) => message.messageId)).toEqual([
      '<po-10042@orders.invalid.test>',
    ])
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
