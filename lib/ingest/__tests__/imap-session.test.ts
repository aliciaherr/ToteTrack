import { describe, it, expect } from 'vitest'
import type { FetchMessageObject } from 'imapflow'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { isSyntheticMessageId } from '../identity'
import { assertUsableWatermark, FIRST_IMAP_UID, toDeclaredMessage } from '../imap-session'
import { MAX_HEADER_BYTES } from '../limits.constants'
import type { GmailImapConfig } from '../types'

// No socket anywhere in this file: both functions under test are pure, and
// they are the two places a malformed server response or a bad watermark would
// otherwise disable a cap silently. Credentials are the usual obviously-fake
// values on the reserved `.test` TLD (SEC-01).
const FAKE_CONFIG: GmailImapConfig = {
  host: 'imap.invalid.test',
  user: 'ingest-fixture@invalid.test',
  appPassword: 'not-a-real-app-password',
}

function listing(overrides: Partial<FetchMessageObject> = {}): FetchMessageObject {
  return {
    seq: 1,
    uid: 4,
    size: 2048,
    envelope: { messageId: '<po-10042@orders.invalid.test>', subject: 'PO 10042 attached' },
    ...overrides,
  } as FetchMessageObject
}

describe('toDeclaredMessage', () => {
  it('carries the declared size and the envelope headers across', () => {
    const declared = toDeclaredMessage(listing(), FAKE_CONFIG)

    expect(declared).toMatchObject({
      uid: 4,
      declaredSize: 2048,
      // Canonicalised: the RFC 5322 delimiters are stripped (H-03).
      messageId: 'po-10042@orders.invalid.test',
      subject: 'PO 10042 attached',
    })
  })

  // L-13. `typeof NaN === 'number'`, so the original guard let it through —
  // and one NaN made `bytesAdmitted` NaN, after which every comparison is
  // false and every remaining message in the run was admitted unconditionally.
  it('refuses a size that is not a usable number rather than guessing one', () => {
    for (const size of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, undefined]) {
      const bad = listing({ size } as Partial<FetchMessageObject>)

      expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(ImapConnectionError)
      expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(/RFC822\.SIZE/)
    }
  })

  // SEC-05: the failure names the mailbox message and nothing from it.
  it('names the UID in that failure and no part of the message', () => {
    const bad = listing({ size: Number.NaN, envelope: { subject: 'PO 10042 attached' } })

    expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(/UID 4/)
    expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).not.toThrow(/PO 10042/)
  })

  // The envelope side's own canonicalisation, asserted here because removing
  // it from `toDeclaredMessage` would leave every loop test green: the fake
  // session canonicalises at the same point, so it cannot catch this (H-03).
  it('canonicalises the envelope Message-ID, stripping delimiters itself', () => {
    for (const sentId of [
      '<po-10042@orders.invalid.test>',
      'po-10042@orders.invalid.test',
      '<po-10042@orders.invalid.test',
      'po-10042@orders.invalid.test>',
    ]) {
      const declared = toDeclaredMessage(listing({ envelope: { messageId: sentId } }), FAKE_CONFIG)

      expect(declared.messageId).toBe('po-10042@orders.invalid.test')
    }
  })

  it('treats an envelope Message-ID of only delimiters as absent', () => {
    for (const empty of ['<>', '<', '>', '   ']) {
      const declared = toDeclaredMessage(listing({ envelope: { messageId: empty } }), FAKE_CONFIG)

      // `gmail.ts` then supplies the UID stand-in, as for an absent header.
      expect(declared.messageId).toBeNull()
    }
  })

  it('treats an absent Message-ID as absent rather than empty', () => {
    const anonymous = toDeclaredMessage(listing({ envelope: { subject: 'No id' } }), FAKE_CONFIG)

    // `gmail.ts` supplies the UID stand-in; this layer only reports the gap.
    expect(anonymous.messageId).toBeNull()
  })

  // M-06, on the refusal path: these reach `inbound_emails` straight from the
  // envelope, and `message_id` is a unique btree key with a hard size limit.
  it('bounds an over-long envelope Message-ID and subject', () => {
    const long = 'y'.repeat(MAX_HEADER_BYTES * 3)
    const bloated = toDeclaredMessage(
      listing({ envelope: { messageId: `<${long}@invalid.test>`, subject: long } }),
      FAKE_CONFIG
    )

    expect(Buffer.byteLength(bloated.messageId ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    expect(Buffer.byteLength(bloated.subject ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    expect(isSyntheticMessageId(bloated.messageId as string)).toBe(true)
  })
})

describe('assertUsableWatermark', () => {
  it('accepts the first valid UID and anything above it', () => {
    expect(() => assertUsableWatermark(FIRST_IMAP_UID)).not.toThrow()
    expect(() => assertUsableWatermark(512)).not.toThrow()
  })

  // L-14: the value is interpolated into the IMAP fetch range, and the
  // TypeScript `number` type is not a runtime check. Task 102 will supply it
  // from persisted state, which is where a type stops being sufficient.
  it('rejects anything that is not a safe integer UID', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => assertUsableWatermark(bad)).toThrow(IngestConfigError)
      expect(() => assertUsableWatermark(bad)).toThrow(/sinceUid/)
    }
  })
})
