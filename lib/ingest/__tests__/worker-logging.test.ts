import { inspect } from 'node:util'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db', () => ({ db: {} }))

import { makePo } from '@/lib/checks/__tests__/fixtures'
import { DatabaseError } from '@/lib/errors'
import { OpenRouterHttpError } from '@/lib/extraction/errors'
import { drainExtractionBatch } from '../worker'
import { CONFIG, RENDERED_PAGES, claimed, makeDeps } from './worker-fixtures'

// L-A / SEC-05 / MEDIUM-07: the worker's logs carry identifiers, counts and
// timings only, and `sourceText` is never handed to a write. Every document
// value below carries a marker; no console call may contain one.

const MARKERS = {
  customer: 'MARKER-CUSTOMER-NAME',
  quote: 'MARKER-QUOTE',
  body: 'MARKER-BODY-TEXT',
  source: 'MARKER-SOURCE-TEXT',
  param: 'MARKER-QUERY-PARAM',
}

const markedReading = {
  extracted: makePo({ customerName: { value: MARKERS.customer, quote: MARKERS.quote } }),
  sourceText: [`${MARKERS.source} page one`],
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

let printed: () => string

beforeEach(() => {
  const spies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
  printed = () => spies.flatMap((spy) => spy.mock.calls).map((args) => inspect(args, { depth: 10 })).join('\n')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function expectNoMarkers(text: string): void {
  for (const marker of Object.values(MARKERS)) expect(text).not.toContain(marker)
}

describe('worker logging (L-A, SEC-05)', () => {
  it('logs only id, kind, model, outcome, attempt, pages and duration for a completed row', async () => {
    const deps = makeDeps([claimed()], {}, markedReading)

    await drainExtractionBatch(deps)

    const [, entry] = vi.mocked(console.info).mock.calls[0]
    expect(Object.keys(entry as object).sort()).toEqual(
      ['attempt', 'durationMs', 'model', 'outcome', 'pages', 'rowId', 'sourceKind'],
    )
    expect(entry).toMatchObject({ model: CONFIG.model, outcome: 'completed', pages: RENDERED_PAGES })
    expectNoMarkers(printed())
  })

  it('never logs body text, extracted values or query params on any failure path', async () => {
    const leakyDbError = new DatabaseError('completeExtraction', 'down', {
      cause: new Error(`Failed query: params: ${MARKERS.param},${MARKERS.customer}`),
    })
    const deps = makeDeps(
      [
        claimed({ id: 'body', source_kind: 'email_body', document_path: null, body_text: MARKERS.body }),
        claimed({ id: 'http' }),
      ],
      {
        completeExtraction: vi.fn().mockRejectedValueOnce(leakyDbError),
        extractPo: vi.fn()
          .mockResolvedValueOnce(markedReading)
          .mockRejectedValueOnce(new OpenRouterHttpError(502, 'test/model', `upstream echoed ${MARKERS.quote}`)),
        releaseForRetry: vi.fn().mockRejectedValue(new Error(`params: ${MARKERS.param}`)),
      },
    )

    const summary = await drainExtractionBatch(deps)

    expect(summary.stranded).toBe(2)
    expectNoMarkers(printed())
  })
})

describe('sourceText is never persisted (MEDIUM-07)', () => {
  it('hands the write no trace of the document text', async () => {
    const deps = makeDeps([claimed()], {}, markedReading)

    await drainExtractionBatch(deps)

    const written = JSON.stringify(vi.mocked(deps.completeExtraction).mock.calls[0])
    expect(written).not.toContain(MARKERS.source)
    expect(written).toContain(MARKERS.customer)
  })
})
