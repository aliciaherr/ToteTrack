import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HeroCards from '../HeroCards'
import type { DashboardStats } from '@/db/queries/dashboard'

function baseStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    period: 'monthly',
    totalRevenue: 12500,
    priorPeriodRevenue: 10000,
    deltaPercent: 25,
    openCount: 4,
    completedInPeriodCount: 9,
    ...overrides,
  }
}

describe('HeroCards', () => {
  it('renders the Total Revenue label and the revenue total as USD currency without decimals', () => {
    render(<HeroCards stats={baseStats({ totalRevenue: 128540 })} />)
    expect(screen.getByText('Total Revenue')).toBeInTheDocument()
    expect(screen.getByText('$128,540')).toBeInTheDocument()
  })

  it('renders a positive signed delta percentage and the period label', () => {
    render(<HeroCards stats={baseStats({ deltaPercent: 25, period: 'monthly' })} />)
    expect(screen.getByText('+25%')).toBeInTheDocument()
    expect(screen.getByText('vs last month')).toBeInTheDocument()
  })

  it('renders a negative signed delta percentage', () => {
    render(<HeroCards stats={baseStats({ deltaPercent: -12.3, period: 'yearly' })} />)
    expect(screen.getByText('-12.3%')).toBeInTheDocument()
    expect(screen.getByText('vs last year')).toBeInTheDocument()
  })

  it('renders an em-dash when deltaPercent is null (prior period had zero revenue)', () => {
    render(<HeroCards stats={baseStats({ deltaPercent: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders open count as the primary figure and completed-in-period count as the secondary', () => {
    render(<HeroCards stats={baseStats({ openCount: 12, completedInPeriodCount: 3 })} />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/completed this month/)).toBeInTheDocument()
  })

  it('uses the yearly label when period is yearly', () => {
    render(<HeroCards stats={baseStats({ period: 'yearly', completedInPeriodCount: 47 })} />)
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText(/completed this year/)).toBeInTheDocument()
  })
})
