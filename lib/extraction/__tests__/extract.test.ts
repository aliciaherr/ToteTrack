// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExtractionResponseError, PdfTooManyPagesError, TextInputTooLongError } from '../errors'
import { MAX_PDF_PAGES, MAX_TEXT_INPUT_CHARS, OWN_COMPANY_NAMES } from '../extraction.constants'
import { extractPo } from '../extract'
import { callOpenRouter } from '../openrouter'
import { buildSystemPrompt } from '../prompt'
import type { ExtractedPo, ExtractionConfig, ExtractionDeps, ExtractionRequest } from '../types'

// Neither the native PDF renderer nor the network is ever reached: both modules
// are mocked, and every fixture is invented (fake company, `.test` addresses).
vi.mock('../render-pdf', () => ({ renderPdfPages: vi.fn() }))
vi.mock('../openrouter', () => ({ callOpenRouter: vi.fn() }))

const mockedCall = vi.mocked(callOpenRouter)
const CONFIG: ExtractionConfig = { apiKey: 'sk-fake-test-key', model: 'test/model-1' }

const VALID_PO: ExtractedPo = {
  isPurchaseOrder: true,
  poNumberCandidates: [{ value: 'PO-0001', label: 'Purchase Order No.', quote: 'Purchase Order No. PO-0001' }],
  customerName: { value: 'Example Widgets Co', quote: 'Example Widgets Co' },
  shipToAddress: { value: '1 Test Way, Testville', quote: '1 Test Way, Testville' },
  billToAddress: { value: null, quote: '' },
  dates: [{ value: '2026-01-02', label: 'Need Date', role: 'delivery', quote: '01/02/26' }],
  statedTotal: { value: 1000, quote: '$1,000.00' },
  lines: [
    { kind: 'tote', toteType: '275_recon', quantity: 10, unitPrice: 100, lineTotal: 1000, quote: '10 275 RECON 100.00' },
  ],
}

function makeDeps(pages: Buffer[] = []): ExtractionDeps & { renderPdfPages: ReturnType<typeof vi.fn> } {
  return {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    renderPdfPages: vi.fn().mockResolvedValue(pages),
  }
}

function sentRequest(): ExtractionRequest {
  expect(mockedCall).toHaveBeenCalledTimes(1)
  return mockedCall.mock.calls[0][0]
}

beforeEach(() => {
  mockedCall.mockReset()
  mockedCall.mockResolvedValue(VALID_PO)
})

describe('extractPo — input by kind', () => {
  it('renders a PDF with MAX_PDF_PAGES and sends each page as a PNG data URL', async () => {
    const pages = [Buffer.from('fake-png-page-1'), Buffer.from('fake-png-page-2')]
    const deps = makeDeps(pages)
    const pdf = Buffer.from('%PDF-1.4 fake')

    await extractPo({ kind: 'pdf', bytes: pdf }, CONFIG, deps)

    expect(deps.renderPdfPages).toHaveBeenCalledWith(pdf, MAX_PDF_PAGES)
    const images = sentRequest().content.filter((part) => part.type === 'image_url')
    expect(images).toEqual(
      pages.map((png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }))
    )
    expect(sentRequest().content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('2 page') })
  })

  it('sends an image unmodified with its own mime type, without rendering', async () => {
    const deps = makeDeps()
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])

    await extractPo({ kind: 'image', bytes, mimeType: 'image/jpeg' }, CONFIG, deps)

    expect(deps.renderPdfPages).not.toHaveBeenCalled()
    const images = sentRequest().content.filter((part) => part.type === 'image_url')
    expect(images).toEqual([
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` } },
    ])
  })

  it('sends an email body as a text part', async () => {
    const text = 'Please supply 10 x 275 RECON, PO 0001. Ship to 1 Test Way.'

    await extractPo({ kind: 'text', text }, CONFIG, makeDeps())

    const request = sentRequest()
    expect(request.content).toContainEqual({ type: 'text', text })
    expect(request.content.some((part) => part.type === 'image_url')).toBe(false)
  })

  it('throws TextInputTooLongError over MAX_TEXT_INPUT_CHARS and never calls the model', async () => {
    const deps = makeDeps()
    const text = 'x'.repeat(MAX_TEXT_INPUT_CHARS + 1)

    const error = await extractPo({ kind: 'text', text }, CONFIG, deps).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TextInputTooLongError)
    expect((error as TextInputTooLongError).length).toBe(MAX_TEXT_INPUT_CHARS + 1)
    expect((error as TextInputTooLongError).maxChars).toBe(MAX_TEXT_INPUT_CHARS)
    expect(mockedCall).not.toHaveBeenCalled()
    expect(deps.fetchImpl).not.toHaveBeenCalled()
  })

  it('sends an email body exactly at MAX_TEXT_INPUT_CHARS in full', async () => {
    const text = 'x'.repeat(MAX_TEXT_INPUT_CHARS)

    await extractPo({ kind: 'text', text }, CONFIG, makeDeps())

    expect(sentRequest().content).toContainEqual({ type: 'text', text })
  })

  it('passes the system prompt, config and fetch through to callOpenRouter', async () => {
    const deps = makeDeps()

    await extractPo({ kind: 'text', text: 'x' }, CONFIG, deps)

    expect(mockedCall).toHaveBeenCalledWith(expect.objectContaining({ system: buildSystemPrompt() }), CONFIG, deps.fetchImpl)
  })
})

describe('extractPo — response handling', () => {
  it('returns the validated reading when the model JSON matches the schema', async () => {
    await expect(extractPo({ kind: 'text', text: 'x' }, CONFIG, makeDeps())).resolves.toEqual(VALID_PO)
  })

  it('throws ExtractionResponseError naming paths, not values, on a schema mismatch', async () => {
    mockedCall.mockResolvedValue({ ...VALID_PO, customerName: { value: 'SECRET-VALUE-XYZ' } })

    const error = await extractPo({ kind: 'text', text: 'x' }, CONFIG, makeDeps()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExtractionResponseError)
    expect((error as ExtractionResponseError).model).toBe(CONFIG.model)
    expect((error as Error).message).toContain('customerName.quote')
    expect((error as Error).message).not.toContain('SECRET-VALUE-XYZ')
  })

  it("propagates the renderer's PdfTooManyPagesError unchanged and never calls the model", async () => {
    const tooMany = new PdfTooManyPagesError(9, MAX_PDF_PAGES)
    const deps = makeDeps()
    deps.renderPdfPages.mockRejectedValue(tooMany)

    await expect(extractPo({ kind: 'pdf', bytes: Buffer.from('%PDF') }, CONFIG, deps)).rejects.toBe(tooMany)
    expect(mockedCall).not.toHaveBeenCalled()
  })
})

describe('buildSystemPrompt', () => {
  it('names every one of our company names as the vendor', () => {
    const prompt = buildSystemPrompt()
    for (const name of OWN_COMPANY_NAMES) expect(prompt).toContain(name)
    expect(prompt).toMatch(/NEVER the customer/)
  })
})
