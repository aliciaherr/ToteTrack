import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import PdfPages from '../PdfPages'
import { usePdfPages, type PdfPagesState } from '../usePdfPages'

vi.mock('../usePdfPages', () => ({ usePdfPages: vi.fn() }))

const URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/a.pdf?token=t'

function canvases(count: number) {
  return Array.from({ length: count }, () => {
    const canvas = document.createElement('canvas')
    canvas.toDataURL = () => 'data:image/png;base64,AAAA'
    return canvas
  })
}

function renderWith(state: PdfPagesState) {
  vi.mocked(usePdfPages).mockReturnValue(state)
  return render(<PdfPages url={URL} />)
}

beforeEach(() => vi.mocked(usePdfPages).mockReset())

describe('PdfPages', () => {
  it('shows a loading state', () => {
    renderWith({ status: 'loading' })
    expect(screen.getByText('Loading PDF…')).toBeInTheDocument()
  })

  it('mounts every drawn page, with a link to the file', () => {
    const drawn = canvases(3)
    const { container } = renderWith({ status: 'ready', canvases: drawn, totalPages: 3 })
    expect(container.querySelectorAll('canvas')).toHaveLength(3)
    expect(container.contains(drawn[2])).toBe(true)
    expect(screen.getByRole('link', { name: /open the file/i })).toHaveAttribute('href', URL)
    expect(screen.queryByText(/only the first/i)).toBeNull()
  })

  it('opens a tapped page full screen, and closes it', () => {
    renderWith({ status: 'ready', canvases: canvases(2), totalPages: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge page 2' }))
    expect(screen.getByRole('dialog', { name: 'Expanded document' })).toBeInTheDocument()
    expect(screen.getByAltText('PO image, enlarged')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }))
    expect(screen.queryByRole('dialog')).toBeNull()
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
    expect(link).toHaveAttribute('href', URL)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
