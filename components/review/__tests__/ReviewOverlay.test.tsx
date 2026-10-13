import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetQueue = vi.hoisted(() => vi.fn())
const mockGetSource = vi.hoisted(() => vi.fn())
const mockGetFields = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/review', () => ({
  getReviewQueue: mockGetQueue,
  getReviewSource: mockGetSource,
  getReviewFields: mockGetFields,
}))

import ReviewOverlay from '../ReviewOverlay'
import { CUSTOMERS, reviewFields } from './reviewFields.fixture'

const FIRST = '11111111-1111-1111-1111-111111111111'
const SECOND = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetQueue.mockResolvedValue({ ids: [FIRST, SECOND] })
  mockGetSource.mockResolvedValue({ source: { kind: 'text', text: 'PO 4471' } })
  mockGetFields.mockResolvedValue({ fields: reviewFields(), customers: CUSTOMERS })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('ReviewOverlay', () => {
  it('opens on the first row in queue order', async () => {
    render(<ReviewOverlay onClose={vi.fn()} />)

    expect(await screen.findByText('PO 4471')).toBeInTheDocument()
    expect(mockGetSource).toHaveBeenCalledWith(FIRST)
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'PO details' })).toBeInTheDocument()
  })

  it('closes on Esc and on the close button', async () => {
    const onClose = vi.fn()
    render(<ReviewOverlay onClose={onClose} />)
    await screen.findByText('PO 4471')

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('focuses inside the overlay when it opens', async () => {
    render(<ReviewOverlay onClose={vi.fn()} />)
    await screen.findByText('PO 4471')
    expect(screen.getByRole('dialog', { name: 'Review' })).toContainElement(document.activeElement as HTMLElement)
  })

  it('says so when the queue is empty', async () => {
    mockGetQueue.mockResolvedValue({ ids: [] })
    render(<ReviewOverlay onClose={vi.fn()} />)
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
    expect(mockGetSource).not.toHaveBeenCalled()
  })

  it('offers a retry when the queue fails to load', async () => {
    mockGetQueue.mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' })
    render(<ReviewOverlay onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /retry/i }))
    expect(await screen.findByText('PO 4471')).toBeInTheDocument()
  })

  it('keeps working when the source fails, and retries it', async () => {
    mockGetSource.mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' })
    const onClose = vi.fn()
    render(<ReviewOverlay onClose={onClose} />)

    expect(await screen.findByText("Couldn't load this document.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(mockGetSource).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('PO 4471')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes only the expanded view on Esc while it is up', async () => {
    const onClose = vi.fn()
    render(<ReviewOverlay onClose={onClose} />)
    await screen.findByText('PO 4471')

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Expanded document' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("loads the first row's fields beside its source", async () => {
    render(<ReviewOverlay onClose={vi.fn()} />)

    expect(await screen.findByLabelText('PO Number')).toHaveValue('PO-4471')
    expect(mockGetFields).toHaveBeenCalledWith(FIRST)
  })

  it('keeps the source up when the fields fail, and retries only the fields', async () => {
    mockGetFields.mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' })
    render(<ReviewOverlay onClose={vi.fn()} />)

    expect(await screen.findByText("Couldn't load this PO's values")).toBeInTheDocument()
    expect(screen.getByText('PO 4471')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByLabelText('PO Number')).toHaveValue('PO-4471')
    expect(mockGetSource).toHaveBeenCalledOnce()
  })
})
