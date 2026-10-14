import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/order-document', () => ({
  getOrderDocumentUrl: vi.fn(),
}))

import { getOrderDocumentUrl } from '@/lib/actions/order-document'
import { PODocumentSlot } from '../PODocumentSlot'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'

const mockedGetUrl = vi.mocked(getOrderDocumentUrl)
const SIGNED_URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/inbound/a.pdf?token=t'

const detail = {
  id: '33333333-3333-3333-3333-333333333333',
  document_url: 'inbound/a.pdf',
  source_kind: 'pdf',
} as OrderDetailType

const NO_DOCUMENT_TEXT = 'No document on file. In-app upload is not available in v1.'

describe('PODocumentSlot', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockedGetUrl.mockReset()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('links the signed URL in a new tab when the order has a document', async () => {
    mockedGetUrl.mockResolvedValue({ url: SIGNED_URL })
    render(<PODocumentSlot detail={detail} />)

    const link = await screen.findByRole('link', { name: /view po document/i })
    expect(link).toHaveAttribute('href', SIGNED_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(mockedGetUrl).toHaveBeenCalledWith(detail.id)
  })

  it('never links the stored document path itself', async () => {
    mockedGetUrl.mockResolvedValue({ url: SIGNED_URL })
    const { container } = render(<PODocumentSlot detail={detail} />)
    await screen.findByRole('link', { name: /view po document/i })
    expect(container.querySelector('a[href="inbound/a.pdf"]')).toBeNull()
  })

  it('shows a loading state while the link is signed', () => {
    mockedGetUrl.mockReturnValue(new Promise(() => {}))
    render(<PODocumentSlot detail={detail} />)
    expect(screen.getByText(/loading the po document/i)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the error and retries on tap', async () => {
    mockedGetUrl.mockResolvedValueOnce({ error: 'Could not open the PO document.' })
    mockedGetUrl.mockResolvedValueOnce({ url: SIGNED_URL })
    render(<PODocumentSlot detail={detail} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the PO document.')
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), { orderId: detail.id })
    expect(screen.queryByRole('link')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: /view po document/i })).toHaveAttribute('href', SIGNED_URL)
    expect(mockedGetUrl).toHaveBeenCalledTimes(2)
  })

  it('shows a generic error when the server cannot be reached', async () => {
    mockedGetUrl.mockRejectedValue(new Error('network down'))
    render(<PODocumentSlot detail={detail} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load the po document/i)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('says the order came from an email when there is no file and the source is an email body', async () => {
    render(<PODocumentSlot detail={{ ...detail, document_url: null, source_kind: 'email_body' }} />)
    expect(screen.getByText('Created from an email: no file')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    await waitFor(() => expect(mockedGetUrl).not.toHaveBeenCalled())
  })

  it('keeps the no-document text when there is no document and no review source', () => {
    render(<PODocumentSlot detail={{ ...detail, document_url: null, source_kind: null }} />)
    expect(screen.getByText(NO_DOCUMENT_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(mockedGetUrl).not.toHaveBeenCalled()
  })
})
