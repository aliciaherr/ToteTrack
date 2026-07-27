import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProductionCard from '../ProductionCard'
import {
  formatProductionMix,
  EMPTY_MIX_TEXT,
  MAX_VISIBLE_COMBOS,
} from '../productionCardFormat'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { QtyGridValues } from '@/components/shared/qtyGridValues'

const ZERO_QTY: QtyGridValues = {
  qty_275_recon: 0,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
}

function makeRow(overrides: Partial<CalendarOrderRow> = {}): CalendarOrderRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    po_number: 'PO-1042',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    ...ZERO_QTY,
    qty_275_recon: 12,
    price: '4200.00',
    unit_price_275_recon: '350.00',
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: null,
    unit_price_330_rebot: null,
    unit_price_330_new: null,
    backhaul: false,
    notes: null,
    same_day_delivery: false,
    production_date: null,
    requested_delivery_date: '2026-07-31',
    production_sort_index: null,
    ...overrides,
  }
}

describe('formatProductionMix', () => {
  it('formats a single combo as quantity, size and type code', () => {
    const mix = formatProductionMix({ ...ZERO_QTY, qty_275_recon: 12 })

    expect(mix).toEqual({ text: '12×275 REC', hiddenCount: 0 })
  })

  it('orders combos by size first, then by the TYPE_ROWS order', () => {
    const mix = formatProductionMix({
      ...ZERO_QTY,
      qty_330_recon: 8,
      qty_275_rebot: 5,
      qty_275_recon: 12,
    })

    expect(mix.text).toBe('5×275 REB, 12×275 REC, 8×330 REC')
  })

  it('drops zero cells entirely', () => {
    const mix = formatProductionMix({ ...ZERO_QTY, qty_275_new: 3, qty_330_new: 4 })

    expect(mix.text).toBe('3×275 NEW, 4×330 NEW')
    expect(mix.text).not.toContain('0×')
  })

  it(`lists at most ${MAX_VISIBLE_COMBOS} combos and reports the rest as hidden`, () => {
    const mix = formatProductionMix({
      qty_275_rebot: 1,
      qty_275_recon: 2,
      qty_275_new: 3,
      qty_330_rebot: 4,
      qty_330_recon: 5,
      qty_330_new: 6,
    })

    expect(mix.hiddenCount).toBe(2)
    expect(mix.text.split(', ')).toHaveLength(MAX_VISIBLE_COMBOS)
    expect(mix.text).toBe('1×275 REB, 2×275 REC, 3×275 NEW, 4×330 REB')
  })

  it('returns the em dash and no hidden count when every cell is zero', () => {
    expect(formatProductionMix(ZERO_QTY)).toEqual({ text: EMPTY_MIX_TEXT, hiddenCount: 0 })
  })
})

describe('ProductionCard', () => {
  it('renders up to 4 combos then +N more', () => {
    render(
      <ProductionCard
        row={makeRow({
          qty_275_rebot: 1,
          qty_275_recon: 2,
          qty_275_new: 3,
          qty_330_rebot: 4,
          qty_330_recon: 5,
          qty_330_new: 6,
        })}
      />,
    )

    expect(screen.getByTestId('production-card-mix')).toHaveTextContent(
      '1×275 REB, 2×275 REC, 3×275 NEW, 4×330 REB +2 more',
    )
  })

  it('renders em dash when delivery date is null', () => {
    render(<ProductionCard row={makeRow({ requested_delivery_date: null })} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('formats a present delivery date as MMM d', () => {
    render(<ProductionCard row={makeRow({ requested_delivery_date: '2026-07-31' })} />)

    expect(screen.getByText('Jul 31')).toBeInTheDocument()
  })

  it('renders B and SD tags together', () => {
    render(<ProductionCard row={makeRow({ backhaul: true, same_day_delivery: true })} />)

    expect(screen.getByLabelText('Backhaul')).toBeInTheDocument()
    expect(screen.getByLabelText('Same-day delivery')).toBeInTheDocument()
  })

  it('renders neither tag when the PO carries neither flag', () => {
    render(<ProductionCard row={makeRow()} />)

    expect(screen.queryByLabelText('Backhaul')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Same-day delivery')).not.toBeInTheDocument()
  })

  it.each(['completed', 'invoiced'] as const)(
    '%s cards are dimmed and not draggable',
    (status) => {
      render(<ProductionCard row={makeRow({ status })} />)

      const card = screen.getByTestId('production-card')
      expect(card).not.toHaveAttribute('data-draggable')
      expect(card.className).toContain('opacity-60')
      expect(card.className).not.toContain('cursor-grab')
    },
  )

  it('scheduled cards expose the drag affordance', () => {
    render(<ProductionCard row={makeRow({ status: 'scheduled' })} />)

    const card = screen.getByTestId('production-card')
    expect(card).toHaveAttribute('data-draggable', 'true')
    expect(card.className).toContain('cursor-grab')
  })

  it('never shows a price', () => {
    const { container } = render(
      <ProductionCard row={makeRow({ price: '4200.00', unit_price_275_recon: '350.00' })} />,
    )

    expect(container.textContent).not.toContain('$')
    expect(container.textContent).not.toContain('4200')
    expect(container.textContent).not.toContain('350.00')
  })

  it('falls back to a placeholder when the customer name is null', () => {
    render(<ProductionCard row={makeRow({ customer_name: null })} />)

    expect(screen.getByText('Unknown customer')).toBeInTheDocument()
  })

  it('drives its height from --card-h so every card is uniform', () => {
    render(<ProductionCard row={makeRow()} />)

    expect(screen.getByTestId('production-card')).toHaveStyle({ height: 'var(--card-h)' })
  })
})
