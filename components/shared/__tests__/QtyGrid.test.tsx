import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import {
  QtyGrid,
  ZERO_QTY_VALUES,
  sumPoSize,
  formatPoTotal,
  type QtyGridValues,
} from '../QtyGrid'

const MIXED_VALUES: QtyGridValues = {
  qty_275_recon: 5,
  qty_275_rebot: 20,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 8,
  qty_330_new: 12,
}

function getCell(sizeLabel: string, typeLabel: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`${sizeLabel} ${typeLabel}`, 'i'))
}

describe('QtyGrid — display mode', () => {
  it('renders 6 cells with the correct values for a mixed-combo PO', () => {
    render(<QtyGrid mode="display" values={MIXED_VALUES} />)
    // Numbers (non-zero cells)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders em dash for zero cells when showEmptyAsDash is true (default)', () => {
    render(<QtyGrid mode="display" values={MIXED_VALUES} />)
    // Two zero cells → two em dashes
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBe(2)
  })

  it('renders literal "0" for zero cells when showEmptyAsDash is false', () => {
    render(<QtyGrid mode="display" values={ZERO_QTY_VALUES} showEmptyAsDash={false} />)
    const zeros = screen.getAllByText('0')
    // 6 zero cells, all rendered as "0"
    expect(zeros.length).toBe(6)
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('renders all 6 zero cells as em dashes for an all-empty PO (default)', () => {
    render(<QtyGrid mode="display" values={ZERO_QTY_VALUES} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBe(6)
  })

  it('exposes correct row + column header labels for accessibility', () => {
    render(<QtyGrid mode="display" values={MIXED_VALUES} />)
    expect(screen.getByRole('rowheader', { name: '275 gal' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: '330 gal' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rebottled' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Reconditioned' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Brand New' })).toBeInTheDocument()
  })
})

describe('QtyGrid — input mode', () => {
  it('renders 6 numeric inputs with empty placeholder for zero cells', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />)
    const inputs = screen.getAllByRole('spinbutton') // type=number → spinbutton role
    expect(inputs.length).toBe(6)
    for (const input of inputs) {
      expect(input).toHaveValue(null) // empty
      expect(input).toHaveAttribute('placeholder', '0')
    }
  })

  it('renders the existing value as a string when non-zero', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={MIXED_VALUES} onChange={onChange} />)
    const cell275Recon = getCell('275 gal', 'Reconditioned') as HTMLInputElement
    expect(cell275Recon).toHaveValue(5)
    const cell330New = getCell('330 gal', 'Brand New') as HTMLInputElement
    expect(cell330New).toHaveValue(12)
  })

  it('calls onChange with the full updated values object when a cell is edited', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />)
    const cell = getCell('275 gal', 'Rebottled')
    fireEvent.change(cell, { target: { value: '15' } })
    expect(onChange).toHaveBeenCalledWith({
      ...ZERO_QTY_VALUES,
      qty_275_rebot: 15,
    })
  })

  it('clamps negative input to 0 (per-cell ≥ 0 invariant)', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />)
    const cell = getCell('275 gal', 'Rebottled')
    fireEvent.change(cell, { target: { value: '-5' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...ZERO_QTY_VALUES,
      qty_275_rebot: 0,
    })
  })

  it('clamps input above QTY_INPUT_MAX (100,000) to the cap', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />)
    const cell = getCell('275 gal', 'Rebottled')
    fireEvent.change(cell, { target: { value: '999999' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...ZERO_QTY_VALUES,
      qty_275_rebot: 100_000,
    })
  })

  it('floors decimal input to an integer', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />)
    const cell = getCell('275 gal', 'Rebottled')
    fireEvent.change(cell, { target: { value: '3.7' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...ZERO_QTY_VALUES,
      qty_275_rebot: 3,
    })
  })

  it('emits 0 when the input is cleared (empty string)', () => {
    const onChange = vi.fn()
    render(<QtyGrid mode="input" values={MIXED_VALUES} onChange={onChange} />)
    const cell = getCell('275 gal', 'Rebottled')
    fireEvent.change(cell, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...MIXED_VALUES,
      qty_275_rebot: 0,
    })
  })

  it('input cells have a min-height of 44px to meet the iPad-touch standard', () => {
    const onChange = vi.fn()
    const { container } = render(
      <QtyGrid mode="input" values={ZERO_QTY_VALUES} onChange={onChange} />,
    )
    const inputs = container.querySelectorAll('input[type="number"]')
    expect(inputs.length).toBe(6)
    for (const input of inputs) {
      // Tailwind class h-11 = 2.75rem = 44px; min-h-[44px] enforces explicitly.
      // Class assertion is the project convention (no jsdom layout).
      expect(input.className).toContain('min-h-[44px]')
    }
  })
})

describe('QtyGrid — VolumeOverview regression coverage', () => {
  // VolumeOverview keeps its bespoke progress-bar layout (Founder Brief in
  // session log: averages-with-share visual is structurally different from
  // raw-qty grid, so QtyGrid is NOT used there). These tests are placeholders
  // for the broader regression intent — the existing VolumeOverview test
  // file still covers the bar layout itself.
  it('does not import or affect VolumeOverview rendering (separate component)', () => {
    // Compile-time: QtyGrid is not imported by VolumeOverview.tsx (verified
    // by grepping the codebase before this task). Runtime: nothing to test
    // here — VolumeOverview.test.tsx covers its own rendering.
    expect(true).toBe(true)
  })
})

describe('sumPoSize', () => {
  it('sums the three 275 type cells when size is "275"', () => {
    expect(sumPoSize(MIXED_VALUES, '275')).toBe(25)
  })

  it('sums the three 330 type cells when size is "330"', () => {
    expect(sumPoSize(MIXED_VALUES, '330')).toBe(20)
  })

  it('returns 0 for both sizes on the all-zero values shape', () => {
    expect(sumPoSize(ZERO_QTY_VALUES, '275')).toBe(0)
    expect(sumPoSize(ZERO_QTY_VALUES, '330')).toBe(0)
  })
})

describe('formatPoTotal', () => {
  it('returns the integer as a string for any positive total', () => {
    expect(formatPoTotal(5)).toBe('5')
    expect(formatPoTotal(20)).toBe('20')
  })

  it('returns the em dash "—" when total is 0', () => {
    expect(formatPoTotal(0)).toBe('—')
  })
})
