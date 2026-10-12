import { describe, it, expect } from 'vitest'
import { IngestConfigError } from '@/lib/errors'
import { isAuthorisedTrigger, triggerAuthHeaders } from '../trigger-auth'

const SECRET = 'test-trigger-secret-value'

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/ingest/extract', { method: 'POST', headers })
}

describe('isAuthorisedTrigger', () => {
  it('accepts the exact bearer secret', () => {
    expect(isAuthorisedTrigger(requestWith(triggerAuthHeaders(SECRET)), SECRET)).toBe(true)
  })

  it('rejects a wrong secret of the same length', () => {
    const wrong = SECRET.replace(/.$/, 'X')
    expect(isAuthorisedTrigger(requestWith({ authorization: `Bearer ${wrong}` }), SECRET)).toBe(false)
  })

  it('rejects a secret of a different length without throwing', () => {
    expect(isAuthorisedTrigger(requestWith({ authorization: 'Bearer short' }), SECRET)).toBe(false)
    expect(isAuthorisedTrigger(requestWith({ authorization: `Bearer ${SECRET}extra` }), SECRET)).toBe(false)
  })

  it('rejects a missing header, an empty token and a non-bearer scheme', () => {
    expect(isAuthorisedTrigger(requestWith(), SECRET)).toBe(false)
    expect(isAuthorisedTrigger(requestWith({ authorization: 'Bearer ' }), SECRET)).toBe(false)
    expect(isAuthorisedTrigger(requestWith({ authorization: `Basic ${SECRET}` }), SECRET)).toBe(false)
  })

  it('throws on an unset or blank secret, so the route can never be open', () => {
    expect(() => isAuthorisedTrigger(requestWith({ authorization: 'Bearer ' }), undefined)).toThrow(IngestConfigError)
    expect(() => isAuthorisedTrigger(requestWith({ authorization: 'Bearer   ' }), '   ')).toThrow(IngestConfigError)
  })

  it('never puts the secret in the config error', () => {
    let message = ''
    try {
      isAuthorisedTrigger(requestWith({ authorization: `Bearer ${SECRET}` }), '')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('INGEST_TRIGGER_SECRET')
    expect(message).not.toContain(SECRET)
  })
})

describe('triggerAuthHeaders', () => {
  it('builds the bearer header from a trimmed secret', () => {
    expect(triggerAuthHeaders(` ${SECRET} `)).toEqual({ authorization: `Bearer ${SECRET}` })
  })
})
