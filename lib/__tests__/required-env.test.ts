import { describe, it, expect } from 'vitest'
import { MISSING_ENV_DETAIL, requireEnv } from '../required-env'

class FixtureConfigError extends Error {
  constructor(readonly variable: string, detail: string) {
    super(`${variable} ${detail}`)
  }
}

const toError = (variable: string, detail: string) => new FixtureConfigError(variable, detail)

describe('requireEnv', () => {
  it('returns the trimmed value when the variable is set', () => {
    expect(requireEnv({ SOME_KEY: '  value  ' }, 'SOME_KEY', toError)).toBe('value')
  })

  it.each([undefined, '', '   '])('throws the caller error naming the variable when it is %j', (value) => {
    expect(() => requireEnv({ SOME_KEY: value }, 'SOME_KEY', toError)).toThrow(
      expect.objectContaining({ variable: 'SOME_KEY', message: `SOME_KEY ${MISSING_ENV_DETAIL}` }),
    )
  })
})
