import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BackhaulTag from '../BackhaulTag'

describe('BackhaulTag', () => {
  it('renders the literal "B" label', () => {
    render(<BackhaulTag />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('exposes a "Backhaul" accessible name for screen readers', () => {
    render(<BackhaulTag />)
    expect(screen.getByLabelText(/backhaul/i)).toBeInTheDocument()
  })
})
