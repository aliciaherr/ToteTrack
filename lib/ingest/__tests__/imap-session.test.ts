import { describe, it, expect } from 'vitest'
import type { FetchMessageObject } from 'imapflow'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { UidFetchError } from '../imap-errors'
import {
  assertUsableWatermark,
  FIRST_IMAP_UID,
  toDeclaredMessage,
  usableUidValidity,
} from '../imap-session'
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
  it('carries INTERNALDATE as arrivedAt, and null when absent or unusable', () => {
    const arrived = new Date('2026-10-12T05:00:00.000Z')
    expect(toDeclaredMessage(listing({ internalDate: arrived }), FAKE_CONFIG).arrivedAt).toEqual(arrived)
    expect(toDeclaredMessage(listing({ internalDate: '2026-10-12T05:00:00Z' }), FAKE_CONFIG).arrivedAt).toEqual(arrived)
    expect(toDeclaredMessage(listing(), FAKE_CONFIG).arrivedAt).toBeNull()
    expect(toDeclaredMessage(listing({ internalDate: 'not a date' }), FAKE_CONFIG).arrivedAt).toBeNull()
  })

  it('carries the declared size and the envelope headers across', () => {
    const declared = toDeclaredMessage(listing(), FAKE_CONFIG)

    expect(declared).toMatchObject({
      uid: 4,
      declaredSize: 2048,
      // A label, carried as sent — nothing normalises or branches on it.
      messageId: '<po-10042@orders.invalid.test>',
      subject: 'PO 10042 attached',
    })
  })

  // L-13. `typeof NaN === 'number'`, so the original guard let it through —
  // and one NaN made `bytesAdmitted` NaN, after which every comparison is
  // false and every remaining message in the run was admitted unconditionally.
  // A per-UID failure, not a connection one: the listing goes on and the UID
  // is counted toward giving up (CONSTRAINT-37).
  it('refuses a size that is not a usable number rather than guessing one', () => {
    for (const size of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, undefined]) {
      const bad = listing({ size } as Partial<FetchMessageObject>)

      expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(UidFetchError)
      expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(/RFC822\.SIZE/)
    }
  })

  // SEC-05: the failure names the mailbox message and nothing from it.
  it('names the UID in that failure and no part of the message', () => {
    const bad = listing({ size: Number.NaN, envelope: { subject: 'PO 10042 attached' } })

    expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).toThrow(/UID 4/)
    expect(() => toDeclaredMessage(bad, FAKE_CONFIG)).not.toThrow(/PO 10042/)
  })

  // HIGH-02, on the refusal path: these never pass through mailparser.
  it('strips control characters from envelope headers and drops an implausible date', () => {
    const declared = toDeclaredMessage(
      listing({
        envelope: {
          messageId: '<po\u0000-1@orders.invalid.test>',
          subject: 'PO\u000010042',
          date: new Date(-8_000_000_000_000_000),
        },
      }),
      FAKE_CONFIG
    )

    expect(declared.messageId).toBe('<po-1@orders.invalid.test>')
    expect(declared.subject).toBe('PO10042')
    expect(declared.receivedAt).toBeNull()
  })

  it('treats an absent Message-ID as absent rather than empty', () => {
    const anonymous = toDeclaredMessage(listing({ envelope: { subject: 'No id' } }), FAKE_CONFIG)

    // The UID is the marker, so a missing label costs nothing.
    expect(anonymous.messageId).toBeNull()
  })

  // M-06, on the refusal path: these reach `inbound_emails` straight from the
  // envelope as sender-controlled display text.
  it('bounds an over-long envelope Message-ID and subject', () => {
    const long = 'y'.repeat(MAX_HEADER_BYTES * 3)
    const bloated = toDeclaredMessage(
      listing({ envelope: { messageId: `<${long}@invalid.test>`, subject: long } }),
      FAKE_CONFIG
    )

    expect(Buffer.byteLength(bloated.messageId ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    expect(Buffer.byteLength(bloated.subject ?? '', 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
  })
})

describe('assertUsableWatermark', () => {
  it('accepts the first valid UID and anything above it', () => {
    expect(() => assertUsableWatermark(FIRST_IMAP_UID)).not.toThrow()
    expect(() => assertUsableWatermark(512)).not.toThrow()
  })

  // L-14: the value is interpolated into the IMAP fetch range, and the
  // TypeScript `number` type is not a runtime check, and it is read back from
  // persisted state, which is where a type stops being sufficient.
  it('rejects anything that is not a safe integer UID', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => assertUsableWatermark(bad)).toThrow(IngestConfigError)
      expect(() => assertUsableWatermark(bad)).toThrow(/sinceUid/)
    }
  })
})

describe('usableUidValidity', () => {
  it('converts the bigint imapflow reports into a number', () => {
    expect(usableUidValidity(BigInt(1_234_567), FAKE_CONFIG)).toBe(1_234_567)
    expect(usableUidValidity(BigInt(4_294_967_295), FAKE_CONFIG)).toBe(4_294_967_295)
  })

  // The watermark belongs to a UIDVALIDITY. Without one there is nothing to
  // compare against, so the run must stop rather than trust the stored UIDs.
  it('throws when the mailbox reports no usable UIDVALIDITY', () => {
    for (const bad of [undefined, BigInt(0), BigInt(-1)]) {
      expect(() => usableUidValidity(bad, FAKE_CONFIG)).toThrow(ImapConnectionError)
      expect(() => usableUidValidity(bad, FAKE_CONFIG)).toThrow(/UIDVALIDITY/)
    }
  })
})
