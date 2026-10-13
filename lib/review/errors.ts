/**
 * Errors for the review overlay's source logic (Task 106). Each carries the
 * PO id or the offending value it is about, never customer data (SEC-05).
 */

/** A refusal whose `reason` this build has no wording for: a new reason was added without UI copy. */
export class UnknownRefusalReasonError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(`describeRefusal: no wording for refusal reason "${reason}"`)
    this.name = 'UnknownRefusalReasonError'
    this.reason = reason
  }
}

/** A PO row with no file, no body text and no refusal: nothing exists to show. */
export class ReviewSourceShapeError extends Error {
  readonly poId: string

  constructor(poId: string, detail: string) {
    super(`reviewSourceOf: PO ${poId} ${detail}`)
    this.name = 'ReviewSourceShapeError'
    this.poId = poId
  }
}
