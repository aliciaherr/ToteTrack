import { describe, it, expect } from 'vitest'
import { REDACTED, scrubSecret } from '../scrub-secret'

describe('scrubSecret', () => {
  it('replaces every occurrence of the secret', () => {
    expect(scrubSecret('key fixture-key and again fixture-key', 'fixture-key')).toBe(`key ${REDACTED} and again ${REDACTED}`)
  })

  it('leaves the text unchanged when the secret is blank', () => {
    expect(scrubSecret('nothing to hide', '')).toBe('nothing to hide')
  })
})
