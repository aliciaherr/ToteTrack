import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EMPTY_FORM_VALUES, formValuesToCreateInput, type OrderFormValues } from '@/components/orders/orderFormSchema'

const mockApprove = vi.hoisted(() => vi.fn())
const mockSkip = vi.hoisted(() => vi.fn())
const mockDiscard = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/review-decisions', () => ({
  approveReviewPo: mockApprove,
  skipReviewPo: mockSkip,
  discardReviewPo: mockDiscard,
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }))

import ReviewActions from '../ReviewActions'
import DeleteReviewDialog from '../DeleteReviewDialog'
import { ACME } from './reviewFields.fixture'

const PO_ID = '11111111-1111-1111-1111-111111111111'
const VALUES: OrderFormValues = {
  ...EMPTY_FORM_VALUES,
  po_number: 'PO-4471',
  customer_id: ACME,
  delivery_address: '1 Acme Way',
  qty_275_recon: 10,
  unit_price_275_recon: '100.00',
}

function renderActions(values: OrderFormValues = VALUES) {
  const onDecided = vi.fn()
  render(<ReviewActions poId={PO_ID} values={values} onDecided={onDecided} />)
  return onDecided
}

const button = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('ReviewActions', () => {
  it('lists the problems and sends nothing when Approve is blocked', () => {
    const onDecided = renderActions({ ...VALUES, po_number: '', customer_id: '' })
    fireEvent.click(button('Approve'))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('PO number is required.')
    expect(alert).toHaveTextContent('Please choose a customer.')
    expect(mockApprove).not.toHaveBeenCalled()
    expect(onDecided).not.toHaveBeenCalled()
  })

  it('approves the form, toasts and moves on', async () => {
    mockApprove.mockResolvedValue({ orderId: 'o1', reactivated: false })
    const onDecided = renderActions()
    fireEvent.click(button('Approve'))

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(mockApprove).toHaveBeenCalledWith(PO_ID, formValuesToCreateInput(VALUES))
    expect(mockToast).toHaveBeenCalledWith('Order created.', 'success')
  })

  it('skips, toasts and moves on', async () => {
    mockSkip.mockResolvedValue({ success: true })
    const onDecided = renderActions()
    fireEvent.click(button('Skip'))

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(mockSkip).toHaveBeenCalledWith(PO_ID)
    expect(mockToast).toHaveBeenCalledWith('Skipped.', 'success')
  })

  it('keeps an action error inline and stays on the PO', async () => {
    mockApprove.mockResolvedValue({ error: 'A PO with this number already exists.' })
    const onDecided = renderActions()
    fireEvent.click(button('Approve'))

    expect(await screen.findByRole('alert')).toHaveTextContent('A PO with this number already exists.')
    expect(onDecided).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('reloads the queue without an error when the PO was already handled', async () => {
    mockSkip.mockResolvedValue({ error: 'This PO was already handled.' })
    const onDecided = renderActions()
    fireEvent.click(button('Skip'))

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('shows the generic message and logs the PO id when the call fails in transit', async () => {
    mockSkip.mockRejectedValue(new Error('offline'))
    const onDecided = renderActions()
    fireEvent.click(button('Skip'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ poId: PO_ID }))
    expect(onDecided).not.toHaveBeenCalled()
  })

  it('disables every button while an action runs, so a second tap does nothing', async () => {
    let resolve: (value: { success: true }) => void = () => {}
    mockSkip.mockReturnValue(new Promise((r) => (resolve = r)))
    renderActions()
    fireEvent.click(button('Skip'))
    fireEvent.click(button('Skipping…'))

    expect(button('Skipping…')).toBeDisabled()
    expect(button('Approve')).toBeDisabled()
    expect(button('Delete')).toBeDisabled()
    expect(mockSkip).toHaveBeenCalledTimes(1)

    await act(async () => resolve({ success: true }))
    expect(button('Skip')).toBeEnabled()
  })

  it('deletes only after the in-app confirm', async () => {
    mockDiscard.mockResolvedValue({ success: true })
    const onDecided = renderActions()
    fireEvent.click(button('Delete'))
    expect(mockDiscard).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog', { name: /Delete this PO\?/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(mockDiscard).toHaveBeenCalledWith(PO_ID)
    expect(mockToast).toHaveBeenCalledWith('Deleted.', 'success')
  })
})

describe('DeleteReviewDialog', () => {
  it('cancel does nothing but close', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<DeleteReviewDialog open onCancel={onCancel} onConfirm={onConfirm} />)

    expect(button('Cancel')).toHaveFocus()
    fireEvent.click(button('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirm deletes', () => {
    const onConfirm = vi.fn()
    render(<DeleteReviewDialog open onCancel={vi.fn()} onConfirm={onConfirm} />)

    fireEvent.click(button('Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Esc closes the dialog and stops there, so the overlay behind stays open', () => {
    const onCancel = vi.fn()
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    render(<DeleteReviewDialog open onCancel={onCancel} onConfirm={vi.fn()} />)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', behind)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(behind).not.toHaveBeenCalled()
  })
})
