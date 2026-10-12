// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { extractPo } from '../extract'
import type { ExtractedPo, ExtractionConfig, ExtractionDeps } from '../types'

// Unlike extract.test.ts, `callOpenRouter` is real here: the assertion is on
// the exact HTTP body handed to `fetch`. The fetch is a fake — no network.
const CONFIG: ExtractionConfig = { apiKey: 'sk-fake-test-key', model: 'test/model-1' }
const MARKER = 'UNIQUE-TEXT-LAYER-MARKER-7f3a'

const VALID_PO: ExtractedPo = {
  isPurchaseOrder: true,
  poNumberCandidates: [],
  customerName: { value: null, quote: '' },
  shipToAddress: { value: null, quote: '' },
  billToAddress: { value: null, quote: '' },
  dates: [],
  statedTotal: { value: null, quote: '' },
  lines: [],
}

describe('extractPo — the OpenRouter request body (FB-40)', () => {
  it('never contains the PDF text layer, which is still returned as sourceText', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(VALID_PO) } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const deps: ExtractionDeps = {
      fetchImpl,
      renderPdfPages: vi.fn().mockResolvedValue({ images: [Buffer.from('png')], text: [MARKER] }),
    }

    const { sourceText } = await extractPo({ kind: 'pdf', bytes: Buffer.from('%PDF') }, CONFIG, deps)

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(typeof init.body).toBe('string')
    expect(init.body as string).not.toContain(MARKER)
    expect(sourceText).toEqual([MARKER])
  })
})
