import { ImapFlow, type FetchMessageObject, type ImapFlowOptions, type MailboxLockObject } from 'imapflow'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'
import { UidFetchError } from './imap-errors'
import { IMAP_CONNECTION_TIMEOUT_MS, IMAP_GREETING_TIMEOUT_MS, IMAP_SOCKET_TIMEOUT_MS } from './limits.constants'
import { internalDate, toDeclaredMessage } from './imap-listing'
import type { DeclaredMessage, GmailImapConfig, ImapSession, UnsizedListing } from './types'

export { toDeclaredMessage } from './imap-listing'

/**
 * The live `imapflow` adapter — the only module in `lib/ingest/` that opens a
 * socket.
 *
 * Split out of `gmail.ts` so that file stays under the service-file cap
 * (CQ-02) and so the one piece of this feature that cannot be exercised
 * without a real mailbox sits behind the narrow `ImapSession` contract rather
 * than being tangled with the parsing and budget logic that can. Everything
 * else in the pipeline talks to that interface, which is why the rest of the
 * suite needs no socket.
 *
 * **The two reads are deliberately separate.** `listFrom` asks for sizes and
 * envelopes only; `fetchSource` is the single call that transfers message
 * bytes. Keeping them apart is what lets the byte budget refuse a message
 * before it is downloaded (H-01) — merging them back into one `source: true`
 * fetch would restore the vulnerability in full.
 */

/** IMAPS. Fixed by the protocol, not a Feature 16 tunable, so not a constants-file entry. */
const IMAPS_PORT = 993

/**
 * Gmail's inbox path — the only mailbox ingestion reads, and the key its
 * watermark is stored under (`ingest_mailbox_state.mailbox`).
 */
export const INBOX_PATH = 'INBOX'

/**
 * The lowest valid IMAP UID — i.e. "the whole mailbox". Protocol-fixed, so it
 * lives here with the other protocol facts rather than in the tunables file,
 * and is exported so the reader's watermark default and this module's
 * validation cannot drift onto different numbers.
 */
export const FIRST_IMAP_UID = 1

/** The `imapflow` options: read-only IMAPS, no protocol log, bounded waits. */
function clientOptions(config: GmailImapConfig): ImapFlowOptions {
  return {
    host: config.host,
    port: IMAPS_PORT,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    // The client's own logger writes the IMAP conversation, LOGIN line
    // included, to stdout. Off, unconditionally (SEC-01).
    logger: false,
    // imapflow's defaults allow a 5-minute stall, the whole of the run
    // route's maxDuration (limits.constants.ts).
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
  }
}

/** Logs out; if that fails, drops the socket so it is never left open, then rethrows. */
async function logoutOrClose(client: ImapFlow): Promise<void> {
  try {
    await client.logout()
  } catch (cause) {
    client.close()
    throw cause
  }
}

interface OpenInbox {
  client: ImapFlow
  lock: MailboxLockObject
  uidValidity: number
}

/**
 * Connects, locks the inbox read-only and reads its UIDVALIDITY. Any failure
 * after `connect()` releases what was taken and logs out (falling back to
 * `close()`) before rethrowing, so a failed open never leaks a connection.
 */
async function openInbox(config: GmailImapConfig): Promise<OpenInbox> {
  const client = new ImapFlow(clientOptions(config))
  // imapflow reports a socket timeout or drop as an 'error' event. With no
  // listener Node rethrows it as an uncaught exception and the whole run
  // crashes. Log it here: the pending command rejects on its own and the
  // session sees `usable === false`, so the run fails through its normal path.
  client.on('error', (error: unknown) => {
    console.error('imap-session: connection error', { failure: loggableFailure(error) })
  })
  await client.connect()
  let lock: MailboxLockObject | undefined
  try {
    lock = await client.getMailboxLock(INBOX_PATH, { readOnly: true })
    const uidValidity = usableUidValidity(client.mailbox ? client.mailbox.uidValidity : undefined, config)
    return { client, lock, uidValidity }
  } catch (cause) {
    lock?.release()
    await logoutOrClose(client).catch((logoutFailure: unknown) => {
      console.error('createImapSession: logout after a failed open also failed; the socket was closed', {
        host: config.host,
        user: config.user,
        failure: loggableFailure(logoutFailure),
      })
    })
    throw cause
  }
}

/**
 * Every message from `sinceUid` up, sizes and envelopes only. A row with no
 * usable size comes back as an `UnsizedListing` rather than ending the run.
 */
async function listFromInbox(
  client: ImapFlow,
  config: GmailImapConfig,
  sinceUid: number
): Promise<(DeclaredMessage | UnsizedListing)[]> {
  assertUsableWatermark(sinceUid)
  const range = { uid: `${sinceUid}:*` }
  // `size`, `envelope` and `internalDate`, and pointedly **not** `source`:
  // this listing is what the byte budget decides on, so it must cost no
  // attachment bytes. Adding `source` here would silently restore H-01
  // (`types.ts`). `internalDate` is the server's arrival time, which the
  // give-up placeholder carries (CONSTRAINT-37).
  const query = { uid: true, size: true, envelope: true, internalDate: true }
  // The listing is read to the end **before** anything is yielded.
  // imapflow runs one command at a time and parks its reader while a
  // `fetch()` consumer works on a row, so a download issued from inside a
  // live `fetch()` loop waits on a FETCH that waits on it: a deadlock that
  // hangs the run until the platform kills it. The listing is sizes and
  // envelopes only, so buffering it costs no message bytes.
  const listed: (DeclaredMessage | UnsizedListing)[] = []
  for await (const message of client.fetch(range, query, { uid: true })) {
    listed.push(listingEntry(message, config))
  }
  return listed
}

/** One listing row; an unsized one is logged by UID and marked, never guessed at. */
function listingEntry(message: FetchMessageObject, config: GmailImapConfig): DeclaredMessage | UnsizedListing {
  try {
    return toDeclaredMessage(message, config)
  } catch (cause) {
    if (!(cause instanceof UidFetchError)) throw cause
    console.error('createImapSession: a listed UID has no usable RFC822.SIZE; it is counted as a failed UID', {
      uid: message.uid,
    })
    return { uid: message.uid, arrivedAt: internalDate(message.internalDate), unsized: true }
  }
}

/**
 * The error for one UID that could not be read: per-UID while the connection
 * is still usable, so the run carries on and the give-up rule counts it;
 * `ImapConnectionError` once it is not, so the run stops.
 */
function uidFailure(client: ImapFlow, config: GmailImapConfig, uid: number, reason: string, cause?: unknown): Error {
  if (client.usable) return new UidFetchError(uid, reason, { cause })
  return new ImapConnectionError(config.host, config.user, `UID ${uid} ${reason}; the connection is no longer usable`, {
    cause,
  })
}

/** The one call that transfers message bytes (H-01). */
async function fetchSourceOf(client: ImapFlow, config: GmailImapConfig, uid: number): Promise<Buffer> {
  let message: FetchMessageObject | false | undefined
  try {
    message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
  } catch (cause) {
    // Class name only: imapflow's message is not ours to vouch for (SEC-05).
    const reason = cause instanceof Error ? cause.name : typeof cause
    throw uidFailure(client, config, uid, `download failed (${reason})`, cause)
  }
  if (!message || !message.source) throw uidFailure(client, config, uid, 'returned no source bytes')
  return message.source
}

/**
 * Opens a real `imapflow` session against `config`, read-only.
 *
 * This is the production value for `GmailDeps.openSession`. It is exported
 * separately rather than defaulted inside `fetchUnprocessedMail`, so no test
 * can reach a live mailbox by forgetting to inject a fake.
 *
 * @param config The mailbox and its credentials.
 * @returns An open session; the caller must `close()` it.
 * @throws whatever `connect()` throws, or `ImapConnectionError` when the inbox
 *   has no usable UIDVALIDITY; the connection is logged out first.
 */
export async function createImapSession(config: GmailImapConfig): Promise<ImapSession> {
  const { client, lock, uidValidity } = await openInbox(config)
  return {
    uidValidity,
    async *listFrom(sinceUid: number): AsyncIterable<DeclaredMessage | UnsizedListing> {
      yield* await listFromInbox(client, config, sinceUid)
    },
    fetchSource: (uid: number) => fetchSourceOf(client, config, uid),
    async close(): Promise<void> {
      lock.release()
      await logoutOrClose(client)
    },
  }
}

/**
 * Rejects a watermark that is not a usable IMAP UID, before it is interpolated
 * into the fetch range (L-14).
 *
 * The TypeScript type is `number`, and a type is not a runtime check: this
 * value is read back from `ingest_mailbox_state`, and whatever it is read from
 * is a place that could otherwise rewrite the IMAP command.
 *
 * Called both here, where the value is interpolated into the protocol string,
 * and in `gmail.ts` where it enters the pipeline — so every `ImapSession`
 * implementation is covered, not only the live one.
 *
 * @param sinceUid The watermark to read from.
 * @throws {IngestConfigError} when it is not a safe integer UID.
 */
export function assertUsableWatermark(sinceUid: number): void {
  if (Number.isSafeInteger(sinceUid) && sinceUid >= FIRST_IMAP_UID) return
  throw new IngestConfigError(
    'sinceUid',
    `is not a usable IMAP UID watermark. It must be a safe integer of at least ${FIRST_IMAP_UID}; it is interpolated into the IMAP fetch range, so it is validated rather than trusted (L-14).`
  )
}

/**
 * The open mailbox's UIDVALIDITY as a number. `imapflow` reports a `bigint`;
 * the value is unsigned 32-bit by RFC 3501, so it converts exactly. Anything
 * else means the watermark cannot be trusted, so it throws rather than guess.
 *
 * Exported for its own unit test, as `toDeclaredMessage` is: a fake
 * `ImapSession` cannot exercise it.
 *
 * @param value `client.mailbox.uidValidity`, or `undefined` if no mailbox is open.
 * @param config The connection, named in a failure. Credentials are never read.
 * @throws {ImapConnectionError} when it is absent or not a positive safe integer.
 */
export function usableUidValidity(value: bigint | undefined, config: GmailImapConfig): number {
  const asNumber = value === undefined ? Number.NaN : Number(value)
  if (Number.isSafeInteger(asNumber) && asNumber >= 1) return asNumber
  throw new ImapConnectionError(
    config.host,
    config.user,
    `${INBOX_PATH} opened without a usable UIDVALIDITY (${String(value)}), so the UID watermark cannot be applied`
  )
}
