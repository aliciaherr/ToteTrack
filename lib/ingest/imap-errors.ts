/**
 * Per-UID IMAP failures, kept apart from `ImapConnectionError` (`@/lib/errors`)
 * on purpose.
 *
 * `ImapConnectionError` means the connection is gone: nothing else in the run
 * can be read, so the run aborts and writes no state. A `UidFetchError` means
 * one message could not be read **while the connection stayed usable**. The
 * run carries on; the UID halts the watermark and is counted by the give-up
 * rule, so a message the server will never hand over cannot pin ingestion
 * forever (CONSTRAINT-34, CONSTRAINT-37).
 *
 * Messages name the UID and an error class only, never message content or
 * imapflow's own text (SEC-05).
 */
export class UidFetchError extends Error {
  readonly uid: number

  /**
   * @param uid The message that could not be read.
   * @param reason What failed, without any message content.
   * @param options The underlying failure, if there was one.
   */
  constructor(uid: number, reason: string, options?: { cause?: unknown }) {
    super(`IMAP UID ${uid} could not be read: ${reason}`, options)
    this.name = 'UidFetchError'
    this.uid = uid
  }
}
