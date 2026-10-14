import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import PdfPages from '../PdfPages'
import { usePdfPages, type PdfPagesState } from '../usePdfPages'

vi.mock('../usePdfPages', () => ({ usePdfPages: vi.fn() }))

const PDF_URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/a.pdf?token=t'

const PAGE_BLOB = new Blob(['png'], { type: 'image/png' })
const OBJECT_URL = 'blob:http://localhost/page-2'

/** Drawn pages whose `toBlob` hands back `blob` (null: the browser could not encode it). */
function canvases(count: number, blob: Blob | null = PAGE_BLOB) {
  return Array.from({ length: count }, () => {
    const canvas = document.createElement('canvas')
    canvas.toBlob = vi.fn((callback: BlobCallback) => callback(blob))
    canvas.toDataURL = vi.fn(() => 'data:image/png;base64,AAAA')
    return canvas
  })
}

function renderWith(state: PdfPagesState) {
  vi.mocked(usePdfPages).mockReturnValue(state)
  return render(<PdfPages url={PDF_URL} />)
}

// jsdom has no object URLs.
const createObjectURL = vi.fn(() => OBJECT_URL)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.mocked(usePdfPages).mockReset()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
})

afterEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.restoreAllMocks()
})

describe('PdfPages', () => {
  it('keeps the drawn pages when the link is re-signed, and refreshes only "Open the file"', () => {
    const resigned = `${PDF_URL}2`
    const { container, rerender } = renderWith({ status: 'ready', canvases: canvases(2), totalPages: 2 })

    rerender(<PdfPages url={resigned} />)

    // Every draw call still names the URL it mounted with, so nothing reloads.
    expect(vi.mocked(usePdfPages).mock.calls.every(([url]) => url === PDF_URL)).toBe(true)
    expect(container.querySelectorAll('canvas')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /open the file/i })).toHaveAttribute('href', resigned)
  })

  it('shows a loading state', () => {
    renderWith({ status: 'loading' })
    expect(screen.getByText('Loading PDF…')).toBeInTheDocument()
  })

  it('mounts every drawn page, with a link to the file', () => {
    const drawn = canvases(3)
    const { container } = renderWith({ status: 'ready', canvases: drawn, totalPages: 3 })
    expect(container.querySelectorAll('canvas')).toHaveLength(3)
    expect(container.contains(drawn[2])).toBe(true)
    expect(screen.getByRole('link', { name: /open the file/i })).toHaveAttribute('href', PDF_URL)
    expect(screen.queryByText(/only the first/i)).toBeNull()
  })

  it('opens a tapped page full screen from a blob URL, and revokes it on close', () => {
    const drawn = canvases(2)
    renderWith({ status: 'ready', canvases: drawn, totalPages: 2 })
    const enlarge = screen.getByRole('button', { name: 'Enlarge page 2' })
    fireEvent.click(enlarge)

    expect(drawn[1].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(drawn[1].toDataURL).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledWith(PAGE_BLOB)
    expect(screen.getByRole('dialog', { name: 'Expanded document' })).toBeInTheDocument()
    expect(screen.getByAltText('PO image, enlarged')).toHaveAttribute('src', OBJECT_URL)
    expect(screen.getByRole('button', { name: 'Close expanded view' })).toHaveFocus()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    expect(enlarge).toHaveFocus()
  })

  it('revokes the blob URL when the view unmounts with a page open', () => {
    const { unmount } = renderWith({ status: 'ready', canvases: canvases(1), totalPages: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge page 1' }))

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
  })

  it('says so, and logs it, when the page cannot be encoded (EH-01)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWith({ status: 'ready', canvases: canvases(1, null), totalPages: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge page 1' }))

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't enlarge this page.")
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('useEnlargedPage'), expect.anything())
  })

  it(`says only the first ${MAX_PDF_PAGES} pages are shown for a longer PDF`, () => {
    renderWith({ status: 'ready', canvases: canvases(MAX_PDF_PAGES), totalPages: 12 })
    expect(screen.getByText(`Only the first ${MAX_PDF_PAGES} pages are shown.`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open the file/i })).toBeInTheDocument()
  })

  it('falls back to the file link when the PDF cannot be displayed, never a blank pane', () => {
    renderWith({ status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't display this PDF.")
    const link = screen.getByRole('link', { name: /open the file/i })
    expect(link).toHaveAttribute('href', PDF_URL)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
