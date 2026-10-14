import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CustomerChoices from '../CustomerChoices'
import FieldStatusFrame from '../FieldStatusFrame'
import ToCheckSection from '../ToCheckSection'
import OptionChips from '../OptionChips'
import { ACME, BETA, CUSTOMERS, GAMMA, reviewFields } from './reviewFields.fixture'

const OPTIONS = reviewFields().deliveryDateOptions

describe('OptionChips', () => {
  it('starts with none chosen and fills the field on a tap', () => {
    const onChoose = vi.fn()
    render(<OptionChips label="Date options" options={OPTIONS} value="" onChoose={onChoose} />)

    const chips = screen.getAllByRole('button')
    expect(chips.every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Deliver by/ }))
    expect(onChoose).toHaveBeenCalledWith('2026-11-09')
  })

  it('renders nothing with no options', () => {
    const { container } = render(<OptionChips label="Date options" options={[]} value="" onChoose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CustomerChoices', () => {
  const choices = reviewFields().customerChoices

  it('ranks the candidates with their labels and sets the customer on a tap', () => {
    const onChoose = vi.fn()
    render(<CustomerChoices choices={choices} customers={CUSTOMERS} value="" onChoose={onChoose} />)

    const group = screen.getByRole('group', { name: 'Matched customers' })
    expect([...group.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Acme Chemicals',
      'Beta LabsInactiveShip-to matches',
    ])
    fireEvent.click(screen.getByRole('button', { name: /Beta Labs/ }))
    expect(onChoose).toHaveBeenCalledWith(BETA)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('reveals the full select on "Choose another customer…"', () => {
    const onChoose = vi.fn()
    render(<CustomerChoices choices={choices} customers={CUSTOMERS} value={ACME} onChoose={onChoose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose another customer…' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Customer' }), { target: { value: GAMMA } })
    expect(onChoose).toHaveBeenCalledWith(GAMMA)
    expect(screen.getByRole('option', { name: 'Beta Labs (inactive)' })).toBeInTheDocument()
  })

  it('shows the full select at once when there are no candidates', () => {
    render(<CustomerChoices choices={[]} customers={CUSTOMERS} value="" onChoose={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Customer' })).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})

describe('ToCheckSection', () => {
  const fields = reviewFields()

  it('lists failed checks first, then missing fields, with the arithmetic under a total mismatch', () => {
    render(<ToCheckSection flags={fields.flags} missingLines={['Delivery date not found: enter it']} totals={fields.totals} liveTotal="1000.00" />)

    expect(screen.getByRole('heading', { name: 'To check (4)' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem').filter((item) => item.parentElement?.getAttribute('aria-label') !== 'Totals')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent(/^The document's total doesn't match qty × price/)
    expect(items[1]).toHaveTextContent('Customer not certain: choose one')
    expect(items[2]).toHaveTextContent('No delivery address on the PO')
    expect(items[3]).toHaveTextContent('Delivery date not found: enter it')
    const arithmetic = screen.getByRole('list', { name: 'Totals' })
    expect(arithmetic).toHaveTextContent('Document total$1,100')
    expect(arithmetic).toHaveTextContent('Qty × price$1,000')
    expect(arithmetic).toHaveTextContent('Freight$100')
  })

  it('adds the inactive-customer line last, only for an inactive selection', () => {
    const { rerender } = render(
      <ToCheckSection flags={[]} missingLines={[]} totals={fields.totals} liveTotal="0.00" inactiveCustomer="Beta Labs" />,
    )
    expect(screen.getByRole('heading', { name: 'To check (1)' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Beta Labs is inactive: approving reactivates it')

    rerender(<ToCheckSection flags={[]} missingLines={[]} totals={fields.totals} liveTotal="0.00" inactiveCustomer={null} />)
    expect(screen.queryByText(/is inactive/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing to check' })).toBeInTheDocument()
  })

  it('says so when there is nothing to check', () => {
    render(<ToCheckSection flags={[]} missingLines={[]} totals={fields.totals} liveTotal="0.00" />)
    expect(screen.getByRole('heading', { name: 'Nothing to check' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('FieldStatusFrame', () => {
  it.each([
    ['confident', 'Read with confidence', 'border-success'],
    ['attention', 'Needs attention', 'border-destructive'],
    ['neutral', 'Edited', 'border-transparent'],
  ] as const)('shows %s with its text and border', (status, text, border) => {
    const { container } = render(<FieldStatusFrame status={status}>field</FieldStatusFrame>)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass(border)
  })
})
