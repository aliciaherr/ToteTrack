// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PdfPageTooLargeError,
  PdfRenderError,
  PdfRenderTimeoutError,
  PdfTooManyPagesError,
} from '../errors'
import { renderPdfPages } from '../render-pdf'

/** Every canvas size render-pdf asks for, so a test can prove none was oversized. */
const canvasAllocations = vi.hoisted(() => [] as Array<[number, number]>)

vi.mock('@napi-rs/canvas', async (importOriginal) => {
  const real = await importOriginal<typeof import('@napi-rs/canvas')>()
  return {
    ...real,
    createCanvas: (width: number, height: number) => {
      canvasAllocations.push([width, height])
      return real.createCanvas(width, height)
    },
  }
})

afterEach(() => {
  canvasAllocations.length = 0
  vi.restoreAllMocks()
})

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Builds a minimal valid PDF with `pageCount` letter-size pages, each drawing
 * one line of Helvetica text. Synthetic on purpose: no real PO ever enters the
 * test suite. Xref offsets are computed from the actual bytes, so the file is
 * well-formed rather than relying on pdfjs's broken-xref recovery.
 *
 * `mediaBox` and `content` override one page (1-based `page`) so a test can
 * build a hostile page among ordinary ones.
 */
function buildPdf(
  pageCount: number,
  override: { page: number; mediaBox?: string; content?: string } = { page: 0 },
): Buffer {
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2)
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (let i = 0; i < pageCount; i++) {
    const own = override.page === i + 1
    const stream =
      (own ? override.content : undefined) ?? `BT /F1 24 Tf 72 700 Td (Synthetic page ${i + 1}) Tj ET`
    const mediaBox = (own ? override.mediaBox : undefined) ?? '0 0 612 792'
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    )
  }
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = body.length
  const entries = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

describe('renderPdfPages', () => {
  it('renders a one-page PDF to a single PNG', async () => {
    const { images: pages } = await renderPdfPages(buildPdf(1), 5)
    expect(pages).toHaveLength(1)
    expect(pages[0].subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  })

  it('renders one PNG per page, in order', async () => {
    const { images: pages } = await renderPdfPages(buildPdf(2), 5)
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    }
  })

  it("returns each page's text layer, in page order", async () => {
    const { text } = await renderPdfPages(buildPdf(2), 5)
    expect(text).toEqual(['Synthetic page 1', 'Synthetic page 2'])
  })

  it('returns an empty string for a page with no text layer (a scan)', async () => {
    const pdf = buildPdf(2, { page: 2, content: '0 0 m 100 100 l S' })
    const { images, text } = await renderPdfPages(pdf, 5)
    expect(images).toHaveLength(2)
    expect(text).toEqual(['Synthetic page 1', ''])
  })

  it('separates two table cells with a space, so their numbers stay apart (Task 122)', async () => {
    // Touching cells in two sizes: pdfjs gives two items and no whitespace item between them.
    const content = 'BT /F1 12 Tf 72 700 Td (330) Tj /F1 10 Tf (23.64) Tj ET'
    const { text } = await renderPdfPages(buildPdf(1, { page: 1, content }), 5)
    expect(text[0]).toBe('330 23.64')
  })

  it('renders exactly at the page limit', async () => {
    await expect(renderPdfPages(buildPdf(2), 2)).resolves.toMatchObject({ images: [expect.any(Buffer), expect.any(Buffer)] })
  })

  it('refuses a PDF over the page limit instead of truncating it', async () => {
    const error = await renderPdfPages(buildPdf(3), 2).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfTooManyPagesError)
    expect(error).toMatchObject({ pageCount: 3, maxPages: 2 })
  })

  it('leaves the caller’s buffer intact', async () => {
    const pdf = buildPdf(1)
    const copy = Buffer.from(pdf)
    await renderPdfPages(pdf, 5)
    expect(pdf.equals(copy)).toBe(true)
  })

  it('throws PdfRenderError with a cause for bytes that are not a PDF', async () => {
    const error = await renderPdfPages(Buffer.from('this is not a pdf at all'), 5).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(PdfRenderError)
    expect((error as PdfRenderError).cause).toBeDefined()
  })

  it('throws PdfRenderError for an empty buffer', async () => {
    await expect(renderPdfPages(Buffer.alloc(0), 5)).rejects.toBeInstanceOf(PdfRenderError)
  })
})

describe('renderPdfPages resource bounds (@security H-02, M-04)', () => {
  it('refuses an oversized page before allocating its canvas', async () => {
    const pdf = buildPdf(2, { page: 2, mediaBox: '0 0 100000 100000' })
    const started = Date.now()
    const error = await renderPdfPages(pdf, 5).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfPageTooLargeError)
    // 100000 pt at scale 2 → 200000 × 200000 px.
    expect(error).toMatchObject({ pageNumber: 2, pixels: 200_000 * 200_000 })
    // Only page 1 (US Letter at scale 2) ever got a canvas.
    expect(canvasAllocations).toEqual([[1224, 1584]])
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('renders a letter page well under the pixel cap', async () => {
    await expect(renderPdfPages(buildPdf(1), 5)).resolves.toMatchObject({ images: [expect.any(Buffer)] })
    expect(canvasAllocations).toEqual([[1224, 1584]])
  })

  it('throws PdfRenderTimeoutError when the deadline passes, and clears its timer', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const error = await renderPdfPages(buildPdf(3), 5, 1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfRenderTimeoutError)
    expect(error).toMatchObject({ timeoutMs: 1 })
    expect(clearSpy).toHaveBeenCalled()
  })

  it('clears the deadline timer after a successful render', async () => {
    const DISTINCT_TIMEOUT_MS = 98_765
    const setSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await renderPdfPages(buildPdf(1), 5, DISTINCT_TIMEOUT_MS)
    const armed = setSpy.mock.calls.findIndex(([, delay]) => delay === DISTINCT_TIMEOUT_MS)
    expect(armed).toBeGreaterThanOrEqual(0)
    expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[armed].value)
  })
})
