import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ReviewFieldsPane from '../ReviewFieldsPane'
import { ACME, CUSTOMERS, reviewFields } from './reviewFields.fixture'
import type { ReviewFields } from '@/lib/review/review-fields.types'

function renderReady(fields: ReviewFields = reviewFields()) {
  return render(<ReviewFieldsPane state={{ status: 'ready', fields, customers: CUSTOMERS }} onRetry={vi.fn()} />)
}

const addressSelect = () => screen.getByRole('combobox', { name: 'Delivery Address' })
/** The status frame around the control with this label. */
const frameOf = (label: string) => screen.getByLabelText(label).closest('[data-status]')

describe('ReviewFieldsPane', () => {
  it('shows the pre-filled values and lists every issue in the top section', () => {
    renderReady()
    expect(screen.getByLabelText('PO Number')).toHaveValue('PO-4471')
    expect(screen.getByLabelText('Total Price')).toHaveTextContent('$1,000')
    expect(screen.getByRole('heading', { name: 'To check (4)' })).toBeInTheDocument()
    expect(screen.getByText('Delivery date not found: enter it')).toBeInTheDocument()
  })

  it('renders no quote text and no flag text under the fields', () => {
    renderReady()
    expect(screen.queryByText(/PO# PO-4471/)).not.toBeInTheDocument()
    expect(screen.queryByText(/x 275 recon/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Found in document|Not found in document/)).not.toBeInTheDocument()
    expect(screen.getAllByText('No delivery address on the PO')).toHaveLength(1)
  })

  it('frames confident fields green and empty or flagged ones red', () => {
    renderReady()
    expect(frameOf('PO Number')).toHaveAttribute('data-status', 'confident')
    expect(frameOf('Requested Delivery Date')).toHaveAttribute('data-status', 'attention')
    expect(frameOf('Total Price')).toHaveAttribute('data-status', 'attention')
    expect(screen.getAllByText('Read with confidence').length).toBeGreaterThan(0)
  })

  it('turns a field neutral once edited', () => {
    renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Deliver by/ }))
    expect(screen.getByLabelText('Requested Delivery Date')).toHaveValue('2026-11-09')
    expect(frameOf('Requested Delivery Date')).toHaveAttribute('data-status', 'neutral')
  })

  it('sets the customer on a tap and offers its saved address for a missing ship-to', () => {
    renderReady()
    expect(screen.queryByRole('button', { name: /Use saved address/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Acme Chemicals/ }))
    expect(screen.getByRole('button', { name: /Acme Chemicals/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use saved address: 1 Acme Way' }))
    expect(addressSelect()).toHaveDisplayValue('1 Acme Way')
    expect(screen.queryByRole('button', { name: /Use saved address/ })).not.toBeInTheDocument()
  })

  it("keeps the PO's typed ship-to across customers, but drops a saved address of the previous one", () => {
    const base = reviewFields()
    renderReady(reviewFields({ values: { ...base.values, customer_id: ACME, delivery_address: 'Dock 4, 2 Main St' } }))
    expect(addressSelect()).toHaveDisplayValue('Current: Dock 4, 2 Main St')

    fireEvent.click(screen.getByRole('button', { name: /Beta Labs/ }))
    expect(addressSelect()).toHaveDisplayValue('Current: Dock 4, 2 Main St')

    fireEvent.change(addressSelect(), { target: { value: 'b1b1b1b1-0000-4000-8000-000000000001' } })
    expect(addressSelect()).toHaveDisplayValue('9 Beta Road')
    fireEvent.click(screen.getByRole('button', { name: /Acme Chemicals/ }))
    expect(addressSelect()).toHaveDisplayValue('Select an address…')
  })

  it('says there is nothing to check on a fully confident PO', () => {
    const base = reviewFields()
    renderReady(
      reviewFields({
        flags: [],
        values: { ...base.values, customer_id: ACME, delivery_address: '1 Acme Way', requested_delivery_date: '2026-11-09' },
      }),
    )
    expect(screen.getByRole('heading', { name: 'Nothing to check' })).toBeInTheDocument()
  })

  it('has no Approve, Skip or Delete', () => {
    renderReady()
    expect(screen.queryByRole('button', { name: /approve|skip|delete/i })).not.toBeInTheDocument()
  })

  it('shows a loading state', () => {
    render(<ReviewFieldsPane state={{ status: 'loading' }} onRetry={vi.fn()} />)
    expect(screen.getByText("Loading this PO's values…")).toBeInTheDocument()
  })

  it('shows the load error with a retry, never a blank pane (EH-01)', () => {
    const onRetry = vi.fn()
    render(<ReviewFieldsPane state={{ status: 'error' }} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this PO's values")
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
