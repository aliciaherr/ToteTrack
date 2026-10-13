import { describe, it, expect } from 'vitest'
import { IngestConfigError } from '@/lib/errors'
import { ingestRouteUrl } from '../app-origin'

describe('ingestRouteUrl', () => {
  it('resolves a route path against the configured origin', () => {
    expect(ingestRouteUrl('/api/ingest/run', 'https://totetrack.example')).toBe('https://totetrack.example/api/ingest/run')
  })

  it('ignores any path on the origin and trims whitespace', () => {
    expect(ingestRouteUrl('/api/ingest/extract', '  http://localhost:3000/somewhere ')).toBe(
      'http://localhost:3000/api/ingest/extract',
    )
  })

  it.each([undefined, '', '   ', 'not a url', 'ftp://totetrack.example', 'javascript:alert(1)'])(
    'throws IngestConfigError naming the variable for %j',
    (origin) => {
      expect(() => ingestRouteUrl('/api/ingest/run', origin)).toThrow(IngestConfigError)
      expect(() => ingestRouteUrl('/api/ingest/run', origin)).toThrow(/INGEST_APP_ORIGIN/)
    },
  )
})
