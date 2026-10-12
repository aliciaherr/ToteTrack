// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PdfRenderError, PdfTooManyPagesError } from '../errors'
import { renderPdfPages } from '../render-pdf'

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Builds a minimal valid PDF with `pageCount` letter-size pages, each drawing
 * one line of Helvetica text. Synthetic on purpose: no real PO ever enters the
 * test suite. Xref offsets are computed from the actual bytes, so the file is
 * well-formed rather than relying on pdfjs's broken-xref recovery.
 */
function buildPdf(pageCount: number): Buffer {
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2)
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (let i = 0; i < pageCount; i++) {
    const stream = `BT /F1 24 Tf 72 700 Td (Synthetic page ${i + 1}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
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
    const pages = await renderPdfPages(buildPdf(1), 5)
    expect(pages).toHaveLength(1)
    expect(pages[0].subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  })

  it('renders one PNG per page, in order', async () => {
    const pages = await renderPdfPages(buildPdf(2), 5)
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    }
  })

  it('renders exactly at the page limit', async () => {
    await expect(renderPdfPages(buildPdf(2), 2)).resolves.toHaveLength(2)
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
