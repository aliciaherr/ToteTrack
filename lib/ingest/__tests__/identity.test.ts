import { describe, it, expect } from 'vitest'
import {
  canonicalMessageId,
  boundHeader,
  isSyntheticMessageId,
  standInMessageId,
  surrogateContentHash,
} from '../identity'
import { attachmentTooLarge, unparseableMessage } from '../limits'
import { MAX_ATTACHMENT_BYTES, MAX_HEADER_BYTES } from '../limits.constants'

// Pure string functions, so no mailbox, no database and no large buffers.
// Every fixture below is an invented address on the reserved `.test` TLD.

const REAL_MESSAGE_ID = '<po-10042@orders.invalid.test>'

describe('standInMessageId', () => {
  it('is deterministic in the UID, so the next run derives the same identity', () => {
    // The property the whole scheme turns on: a message staged under a
    // stand-in must be recognised as already staged, not inserted again.
    expect(standInMessageId(4)).toBe(standInMessageId(4))
    expect(standInMessageId(4)).not.toBe(standInMessageId(5))
  })

  // A real Message-ID is `<id-left@id-right>` (RFC 5322). The stand-in has no
  // angle brackets and no `@`, so nothing downstream can mistake one for a
  // header the sender actually sent.
  it('cannot be confused with a real Message-ID', () => {
    const standIn = standInMessageId(4)

    expect(standIn).not.toContain('<')
    expect(standIn).not.toContain('>')
    expect(standIn).not.toContain('@')
    expect(isSyntheticMessageId(standIn)).toBe(true)
    expect(isSyntheticMessageId(REAL_MESSAGE_ID)).toBe(false)
  })
})

describe('canonicalMessageId', () => {
  // The canonical form is the bare addr-spec: RFC 5322's angle brackets
  // delimit the field, they are not part of the identifier.
  it('strips the RFC 5322 delimiters and keeps the identifier', () => {
    expect(canonicalMessageId(REAL_MESSAGE_ID)).toBe('po-10042@orders.invalid.test')
  })

  // H-03. `imapflow` yields ENVELOPE field 9 as the sender wrote it, while
  // `mailparser` adds the brackets — so without one canonical form a bare
  // Message-ID never matches itself between the pre-filter and the stored row.
  it('maps the bracketed and bare spellings of one header onto one identity', () => {
    expect(canonicalMessageId('bare-id@invalid.test')).toBe(
      canonicalMessageId('<bare-id@invalid.test>')
    )
  })

  it('is idempotent for the spellings a sender actually sends', () => {
    const once = canonicalMessageId(REAL_MESSAGE_ID) as string

    expect(canonicalMessageId(once)).toBe(once)
  })

  // Every spelling in one table, so the next variant cannot slip through on
  // the strength of the handful someone happened to think of. A delimiter is
  // stripped from each end **independently**: an unbalanced one is the case a
  // matched-pair strip missed, and `mailparser` balances it while `imapflow`
  // does not — which is H-03's mechanism exactly.
  const CANONICAL = 'po-10042@orders.invalid.test'
  const SPELLINGS: ReadonlyArray<readonly [string, string | null]> = [
    ['<po-10042@orders.invalid.test>', CANONICAL],
    ['po-10042@orders.invalid.test', CANONICAL],
    ['<po-10042@orders.invalid.test', CANONICAL],
    ['po-10042@orders.invalid.test>', CANONICAL],
    ['  <po-10042@orders.invalid.test>  ', CANONICAL],
    ['  po-10042@orders.invalid.test  ', CANONICAL],
    ['<  po-10042@orders.invalid.test  >', CANONICAL],
    ['<po-10042@orders.invalid.test  ', CANONICAL],
    ['  po-10042@orders.invalid.test>', CANONICAL],
    // Nothing usable left: the caller falls back to the UID stand-in, exactly
    // as it would for a header that was never there.
    ['<>', null],
    ['<', null],
    ['>', null],
    ['   ', null],
    ['', null],
  ]

  it.each(SPELLINGS)('maps %j onto the one canonical identity', (spelling, expected) => {
    expect(canonicalMessageId(spelling)).toBe(expected)
  })

  it('agrees across every non-null spelling of the same header', () => {
    const keys = new Set(
      SPELLINGS.filter(([, expected]) => expected !== null).map(([spelling]) =>
        canonicalMessageId(spelling)
      )
    )

    // One key, or the pre-filter and the stored row can disagree and the
    // message is re-downloaded on every run forever.
    expect(keys.size).toBe(1)
  })

  // M-08: a sender must never be able to produce a value this module would
  // read back as one of its own assigned identities.
  it('digests a sender-supplied value that claims a reserved prefix', () => {
    for (const forged of ['ingest-uid:4', 'ingest-longid:deadbeef', 'ingest-claimed:x']) {
      const stored = canonicalMessageId(forged) as string

      expect(stored).not.toBe(forged)
      expect(stored.startsWith('ingest-claimed:')).toBe(true)
      // Specifically: it cannot collide with the identity UID 4 would be given.
      expect(stored).not.toBe(standInMessageId(4))
    }
  })

  it('cannot be slipped past the reserved-prefix gate by bracketing', () => {
    // The gate runs on the canonical form, so the brackets are already gone.
    expect(canonicalMessageId('<ingest-uid:4>')).toBe(canonicalMessageId('ingest-uid:4'))
    expect(canonicalMessageId('<ingest-uid:4>')).not.toBe(standInMessageId(4))
  })

  it('keeps two different forged claims distinct', () => {
    expect(canonicalMessageId('ingest-uid:4')).not.toBe(canonicalMessageId('ingest-uid:5'))
  })

  it('replaces an over-long Message-ID with a bounded synthetic identity', () => {
    const hostile = `<${'a'.repeat(MAX_HEADER_BYTES * 4)}@orders.invalid.test>`

    const bounded = canonicalMessageId(hostile) as string

    // Postgres cannot index a btree key over 2704 bytes, so the unbounded
    // value could never be inserted at all — the insert would fail on every
    // run and the message would never be marked processed (M-06).
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    expect(isSyntheticMessageId(bounded)).toBe(true)
    expect(bounded).not.toContain('@')
  })

  // A digest, not a truncation: truncating would map every over-long id
  // sharing a prefix onto one identity, so two unrelated messages would
  // collide and the second would be silently skipped as a duplicate.
  it('keeps distinct over-long ids distinct, and the same one stable', () => {
    const base = 'b'.repeat(MAX_HEADER_BYTES * 2)
    const first = canonicalMessageId(`<${base}1@invalid.test>`)
    const second = canonicalMessageId(`<${base}2@invalid.test>`)

    expect(first).not.toBe(second)
    expect(canonicalMessageId(`<${base}1@invalid.test>`)).toBe(first)
  })
})

describe('boundHeader', () => {
  it('passes through a null or an ordinary header unchanged', () => {
    expect(boundHeader(null)).toBeNull()
    expect(boundHeader('PO 10042 attached')).toBe('PO 10042 attached')
  })

  it('bounds an over-long header by bytes, not characters', () => {
    // A four-byte character repeated: 998 of these would be 3992 bytes, well
    // past the btree limit the cap exists to stay under, so a character count
    // would not have been enough.
    const wide = '\u{1F4E6}'.repeat(MAX_HEADER_BYTES)

    const bounded = boundHeader(wide) as string

    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(MAX_HEADER_BYTES)
    // Shortened by whole characters, so no multi-byte sequence was split and
    // no replacement character was introduced.
    expect(bounded).not.toContain('�')
  })
})

describe('surrogateContentHash', () => {
  const failure = attachmentTooLarge(0, MAX_ATTACHMENT_BYTES + 1)

  it('is a hex sha256 digest', () => {
    expect(surrogateContentHash('<a@invalid.test>', failure)).toMatch(/^[0-9a-f]{64}$/)
  })

  // The property the whole surrogate exists for: a re-fetch of the same
  // refusal must not pile up a fresh unrelated row every run.
  it('is stable across two identical refusals of the same message', () => {
    const first = surrogateContentHash('<repeat@invalid.test>', failure)
    const second = surrogateContentHash(
      '<repeat@invalid.test>',
      attachmentTooLarge(0, MAX_ATTACHMENT_BYTES + 1)
    )

    expect(second).toBe(first)
  })

  it('separates two refused attachments within one message', () => {
    const zero = surrogateContentHash('<two-parts@invalid.test>', attachmentTooLarge(0, 999))
    const one = surrogateContentHash('<two-parts@invalid.test>', attachmentTooLarge(1, 999))

    expect(one).not.toBe(zero)
  })

  // It is a surrogate over *identity*, so this is the honest limit of it and
  // not a defect: a hash cannot recognise content that was never read.
  it('differs between two separate sends of the same oversized document', () => {
    const sent = surrogateContentHash('<send-one@invalid.test>', failure)
    const resent = surrogateContentHash('<send-two@invalid.test>', failure)

    expect(resent).not.toBe(sent)
  })

  // `unparseable` carries no measured value and no limit, so the identity
  // string must not be built out of `undefined` — and must still be stable.
  it('is stable and well formed when nothing could be measured', () => {
    const unmeasured = unparseableMessage()
    const first = surrogateContentHash(standInMessageId(9), unmeasured)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(surrogateContentHash(standInMessageId(9), unparseableMessage())).toBe(first)
    expect(surrogateContentHash(standInMessageId(10), unmeasured)).not.toBe(first)
  })
})
