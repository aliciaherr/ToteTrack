import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SourcePane from '../SourcePane'
import RefusalCard from '../RefusalCard'
import ExpandedSource, { ZOOM_MAX } from '../ExpandedSource'
import { openPdf } from '../pdfjsClient'
import type { RefusalDescription, ReviewEmail } from '@/lib/review/review-source'

// pdf.js never loads in jsdom: the PDF view stays in its loading state.
vi.mock('../pdfjsClient', () => ({ openPdf: vi.fn(() => new Promise(() => undefined)) }))

const URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/a?token=t'
const REFUSAL: RefusalDescription = {
  title: 'File type not supported',
  nextStep: 'Ask the sender to re-send it as a PDF or JPG.',
  fileType: '<b>application/zip</b>',
}
const EMAIL: ReviewEmail = {
  from: 'buyer@example.com',
  subject: 'PO 4471',
  receivedAt: '2026-10-12T15:04:05.000Z',
  gmailUrl: 'https://mail.google.com/mail/u/0/#search/rfc822msgid%3Am1',
}

function renderPane(state: Parameters<typeof SourcePane>[0]['state']) {
  const handlers = { onRetry: vi.fn(), onLoadError: vi.fn() }
  render(<SourcePane state={state} {...handlers} />)
  return handlers
}

describe('SourcePane', () => {
  it('shows a loading state', () => {
    renderPane({ status: 'loading' })
    expect(screen.getByText('Loading document…')).toBeInTheDocument()
  })

  it('shows the load error with a retry (EH-01)', () => {
    const { onRetry } = renderPane({ status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this document.")
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows an image, expands it on tap, and reports a failed load', () => {
    const { onLoadError } = renderPane({ status: 'ready', source: { kind: 'image', url: URL } })
    const image = screen.getByAltText('PO image')
    expect(image).toHaveAttribute('src', URL)

    fireEvent.error(image)
    expect(onLoadError).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge PO image' }))
    expect(screen.getByRole('dialog', { name: 'Expanded document' })).toBeInTheDocument()
  })

  it('shows email HTML as literal text, never as markup', () => {
    const html = '<script>alert(1)</script><b>300 totes</b>'
    const { container } = render(
      <SourcePane state={{ status: 'ready', source: { kind: 'text', text: html } }} onRetry={vi.fn()} onLoadError={vi.fn()} />,
    )
    expect(screen.getByText(html)).toBeInTheDocument()
    expect(container.querySelector('script, b')).toBeNull()
  })

  it('hands a PDF to the pdf.js view', () => {
    renderPane({ status: 'ready', source: { kind: 'pdf', url: URL } })
    expect(screen.getByText('Loading PDF…')).toBeInTheDocument()
    expect(openPdf).toHaveBeenCalledWith(URL)
  })

  it('shows the refusal card for a refused row', () => {
    renderPane({ status: 'ready', source: { kind: 'refused', refusal: REFUSAL, email: EMAIL } })
    expect(screen.getByRole('heading', { name: 'File type not supported' })).toBeInTheDocument()
  })
})

describe('RefusalCard', () => {
  it('shows the reason, next step, email details and a Gmail link in a new tab', () => {
    render(<RefusalCard refusal={REFUSAL} email={EMAIL} />)

    expect(screen.getByText(REFUSAL.nextStep)).toBeInTheDocument()
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument()
    expect(screen.getByText('PO 4471')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /open in gmail/i })
    expect(link).toHaveAttribute('href', EMAIL.gmailUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows the file type as plain text (LOW-NEW-2)', () => {
    const { container } = render(<RefusalCard refusal={REFUSAL} email={EMAIL} />)
    expect(screen.getByText('<b>application/zip</b>')).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
  })

  it('has no Gmail link without a message id', () => {
    render(<RefusalCard refusal={REFUSAL} email={{ ...EMAIL, gmailUrl: null }} />)
    expect(screen.queryByRole('link', { name: /open in gmail/i })).not.toBeInTheDocument()
  })
})

describe('ExpandedSource', () => {
  it('zooms within its bounds', () => {
    render(<ExpandedSource source={{ kind: 'image', url: URL }} onClose={vi.fn()} />)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' })

    expect(zoomOut).toBeDisabled()
    for (let i = 0; i < 20; i += 1) fireEvent.click(zoomIn)
    expect(zoomIn).toBeDisabled()
    expect(screen.getByText(`${ZOOM_MAX * 100}%`)).toBeInTheDocument()
    expect(screen.getByAltText('PO image, enlarged')).toHaveStyle({ width: `${ZOOM_MAX * 100}%` })
  })

  it('closes on the close button and on Esc', () => {
    const onClose = vi.fn()
    render(<ExpandedSource source={{ kind: 'text', text: 'PO 4471' }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Esc from reaching handlers underneath', () => {
    const underneath = vi.fn()
    window.addEventListener('keydown', underneath)
    render(<ExpandedSource source={{ kind: 'text', text: 'PO 4471' }} onClose={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', underneath)
    expect(underneath).not.toHaveBeenCalled()
  })
})
