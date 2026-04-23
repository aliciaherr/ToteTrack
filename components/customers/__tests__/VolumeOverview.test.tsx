import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import VolumeOverview from '../VolumeOverview'
import type { VolumeOverview as VolumeOverviewData } from '@/db/queries/customers'

const emptyData: VolumeOverviewData = {
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}

const mixedData: VolumeOverviewData = {
  gal275: { rebottled: 5, reconditioned: 3, brandNew: 2, totalAvg: 10 },
  gal330: { rebottled: 8, reconditioned: 0, brandNew: 0, totalAvg: 8 },
}

describe('VolumeOverview', () => {
  it('renders exactly 6 progress bars (two sizes × three types)', () => {
    render(<VolumeOverview data={mixedData} />)
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(6)
  })

  it('renders "0 totes avg" labels and 0-width bars when no completed orders exist', () => {
    render(<VolumeOverview data={emptyData} />)
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(6)
    for (const bar of bars) {
      expect(bar.getAttribute('aria-valuenow')).toBe('0')
    }
    // "0 totes avg" appears once per row × 6 rows.
    expect(screen.getAllByText('0 totes avg')).toHaveLength(6)
  })

  it('computes bar width as a percentage share of totalAvg within each size', () => {
    render(<VolumeOverview data={mixedData} />)
    // 275 gal: rebottled 5 / total 10 = 50%
    const rebottled275 = screen.getByRole('progressbar', {
      name: /275 gallon rebottled/i,
    })
    expect(rebottled275.getAttribute('aria-valuenow')).toBe('50')
    // 330 gal: rebottled 8 / total 8 = 100%
    const rebottled330 = screen.getByRole('progressbar', {
      name: /330 gallon rebottled/i,
    })
    expect(rebottled330.getAttribute('aria-valuenow')).toBe('100')
  })
})
