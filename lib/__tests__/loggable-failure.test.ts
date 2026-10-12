import { inspect } from 'node:util'
import { describe, it, expect } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from '@/lib/errors'
import { loggableFailure } from '../loggable-failure'

// Invented header values on the reserved `.test` TLD — never real customer data.
const HEADER_PARAMS = ['<po-1@orders.invalid.test>', 'buyer@invalid.test', 'PO 4471 attached']

/** The real production shape: our error, around drizzle's, around the driver's. */
function wrappedDriverFailure(): DatabaseError {
  const driver = Object.assign(new Error(`invalid input value "${HEADER_PARAMS[2]}"`), {
    code: '22021',
    constraint_name: 'inbound_emails_uid_validity_uid_unique',
  })
  const query = new DrizzleQueryError('insert into "inbound_emails" ...', HEADER_PARAMS, driver)
  return new DatabaseError('stageEmailWithPos', 'Failed to stage', { cause: query })
}

describe('loggableFailure', () => {
  it('keeps class names, SQLSTATE, constraint and operation from the whole chain', () => {
    expect(loggableFailure(wrappedDriverFailure())).toEqual({
      error: 'DatabaseError > DrizzleQueryError > Error',
      code: '22021',
      constraint: 'inbound_emails_uid_validity_uid_unique',
      operation: 'stageEmailWithPos',
    })
  })

  // MEDIUM-04: the params and every message — any of which can quote a
  // sender-controlled value — must be absent from what is logged.
  it('carries no params and no message text from any layer', () => {
    const logged = inspect(loggableFailure(wrappedDriverFailure()), { depth: 10 })
    for (const header of HEADER_PARAMS) expect(logged).not.toContain(header)
    expect(logged).not.toContain('invalid input value')
  })

  it('describes a thrown non-error without failing', () => {
    expect(loggableFailure('boom')).toEqual({
      error: 'string',
      code: null,
      constraint: null,
      operation: null,
    })
  })

  it('stops on a cyclic cause chain instead of looping', () => {
    const looped = new Error('first') as Error & { cause?: unknown }
    looped.cause = looped
    expect(loggableFailure(looped).error).toBe('Error')
  })
})
