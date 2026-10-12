import { describe, it, expect } from 'vitest'
import {
  admitMessage,
  attachmentPart,
  attachmentTooLarge,
  checkResultsFor,
  exceedsAttachmentCap,
  exceedsAttachmentCount,
  exceedsMessageCount,
  refusalColumns,
  REFUSED_SOURCE_KIND,
  tooManyAttachments,
  unparseableMessage,
} from '../limits'
import { INGEST_BATCH_SIZE } from '../ingest.constants'
import {
  MAX_ATTACHMENTS_PER_EMAIL,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGES_PER_RUN,
  MAX_TOTAL_INGEST_BYTES,
} from '../limits.constants'
import type { DeclaredMessage } from '../types'

// Pure functions over declared sizes and counts: no mailbox, no database, no
// storage, and — the point of measuring declared sizes — no large buffers.
// Every size below is a number, never an allocation.
function declared(overrides: Partial<DeclaredMessage> = {}): DeclaredMessage {
  return {
    uid: 4,
    declaredSize: 2048,
    messageId: '<po-10042@orders.invalid.test>',
    from: null,
    subject: null,
    receivedAt: null,
    arrivedAt: null,
    ...overrides,
  }
}

describe('the ingestion caps', () => {
  it('derives the batch ceiling from the batch size and the per-attachment cap', () => {
    // Written as a product so raising one cap cannot silently leave the other
    // binding first. If this fails, the relationship was broken, not the value.
    expect(MAX_TOTAL_INGEST_BYTES).toBe(INGEST_BATCH_SIZE * MAX_ATTACHMENT_BYTES)
  })

  it('holds the builder-decided values', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(15 * 1024 * 1024)
    expect(MAX_ATTACHMENTS_PER_EMAIL).toBe(10)
  })
})

describe('admitMessage', () => {
  it('admits a message that fits the bytes left in the invocation', () => {
    expect(admitMessage(declared(), 0)).toEqual({ verdict: 'admit' })
  })

  it('admits a message exactly on the ceiling', () => {
    const exact = declared({ declaredSize: MAX_TOTAL_INGEST_BYTES })
    expect(admitMessage(exact, 0)).toEqual({ verdict: 'admit' })
  })

  // Measured against the batch ceiling, not the per-attachment cap: a declared
  // size includes headers, MIME overhead and base64 inflation, so a legitimate
  // 15MB document arrives as roughly 20MB of RFC822.
  it('admits a message whose declared size exceeds the per-attachment cap alone', () => {
    const inflated = declared({ declaredSize: Math.round(MAX_ATTACHMENT_BYTES * 1.4) })
    expect(admitMessage(inflated, 0)).toEqual({ verdict: 'admit' })
  })

  it('refuses a message that exceeds the ceiling on its own', () => {
    const oversized = declared({ declaredSize: MAX_TOTAL_INGEST_BYTES + 1 })

    const admission = admitMessage(oversized, 0)

    // Refused rather than deferred: no future run has a bigger budget, so
    // retrying forever would be the only alternative to staging it.
    expect(admission).toEqual({
      verdict: 'refuse',
      failure: {
        check: 'ingest_limit',
        reason: 'message_too_large',
        part: 'message',
        measured: MAX_TOTAL_INGEST_BYTES + 1,
        limit: MAX_TOTAL_INGEST_BYTES,
        unit: 'bytes',
      },
    })
  })

  it('defers a message that would fit an empty budget but not the bytes left', () => {
    const half = Math.floor(MAX_TOTAL_INGEST_BYTES / 2)
    const message = declared({ declaredSize: half + 2 })

    const admission = admitMessage(message, half)

    // Deferred, not refused: it is left in the mailbox and drains next run,
    // because staging it would write its message_id and refuse a good PO
    // forever on the strength of when it happened to arrive.
    expect(admission).toEqual({ verdict: 'defer', remainingBytes: MAX_TOTAL_INGEST_BYTES - half })
  })
})

describe('admitMessage failing closed', () => {
  // L-13. Defence in depth behind the adapter's own guard: a fake or future
  // `ImapSession` could supply a size the live adapter would have refused.
  it('refuses a declared size that is not a usable number', () => {
    for (const declaredSize of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      const admission = admitMessage(declared({ declaredSize }), 0)

      // Must not be `admit`: NaN makes every comparison false, and a negative
      // size would *credit* the budget and raise the effective ceiling.
      expect(admission.verdict).toBe('refuse')
      expect(admission).toMatchObject({
        failure: { reason: 'size_not_declared', limit: MAX_TOTAL_INGEST_BYTES },
      })
    }
  })

  it('reports no measured value when there was nothing to measure', () => {
    const admission = admitMessage(declared({ declaredSize: Number.NaN }), 0)

    // Putting a fabricated figure in front of a reviewer would be worse than
    // leaving the field out, and NaN has no JSON representation anyway.
    expect(admission).toMatchObject({ verdict: 'refuse' })
    if (admission.verdict !== 'refuse') throw new Error('expected a refusal')
    expect(admission.failure.measured).toBeUndefined()
  })
})

describe('the message-count cap', () => {
  // M-05: the byte budget alone admits roughly thirty thousand tiny emails.
  it('admits up to the cap and not beyond it', () => {
    expect(exceedsMessageCount(MAX_MESSAGES_PER_RUN - 1)).toBe(false)
    expect(exceedsMessageCount(MAX_MESSAGES_PER_RUN)).toBe(true)
  })
})

describe('unparseableMessage', () => {
  // H-02: nothing was exceeded, the bytes simply could not be read, so there
  // is no measurement and no cap to report.
  it('records the reason with no fabricated measurement', () => {
    expect(unparseableMessage()).toEqual({
      check: 'ingest_limit',
      reason: 'unparseable',
      part: 'message',
    })
  })
})

describe('the per-attachment and per-email caps', () => {
  it('accepts an attachment on the cap and refuses one byte over', () => {
    expect(exceedsAttachmentCap(MAX_ATTACHMENT_BYTES)).toBe(false)
    expect(exceedsAttachmentCap(MAX_ATTACHMENT_BYTES + 1)).toBe(true)
  })

  it('accepts an email on the count cap and refuses one attachment over', () => {
    expect(exceedsAttachmentCount(MAX_ATTACHMENTS_PER_EMAIL)).toBe(false)
    expect(exceedsAttachmentCount(MAX_ATTACHMENTS_PER_EMAIL + 1)).toBe(true)
  })

  it('names the refused attachment by index, never by filename', () => {
    const failure = attachmentTooLarge(3, MAX_ATTACHMENT_BYTES + 100)

    expect(failure).toEqual({
      check: 'ingest_limit',
      reason: 'attachment_too_large',
      part: attachmentPart(3),
      measured: MAX_ATTACHMENT_BYTES + 100,
      limit: MAX_ATTACHMENT_BYTES,
      unit: 'bytes',
    })
    expect(failure.part).toBe('attachment-3')
  })

  it('records a count refusal against the message, with the full count', () => {
    expect(tooManyAttachments(57)).toMatchObject({
      reason: 'too_many_attachments',
      part: 'message',
      measured: 57,
      limit: MAX_ATTACHMENTS_PER_EMAIL,
      unit: 'attachments',
    })
  })
})

describe('how a refusal is persisted', () => {
  const failure = tooManyAttachments(MAX_ATTACHMENTS_PER_EMAIL + 1)

  it('wraps the failure in the failures array the review queue sorts on', () => {
    expect(checkResultsFor(failure)).toEqual({ failures: [failure] })
  })

  it('sends a refused row to pending_review and leaves a real candidate alone', () => {
    expect(refusalColumns(failure)).toEqual({
      status: 'pending_review',
      check_results: { failures: [failure] },
    })
    // A genuine PO's insert must stay exactly what Task 97 wrote, so `status`
    // and `attempt_count` keep their column defaults.
    expect(refusalColumns(null)).toEqual({})
  })

  // The Task 95 invariant: `document_path` is NULL exactly when `source_kind`
  // is `email_body`. A refusal has no stored document, so it takes that kind.
  it('records a refusal under the one source kind that means "no file"', () => {
    expect(REFUSED_SOURCE_KIND).toBe('email_body')
  })
})
