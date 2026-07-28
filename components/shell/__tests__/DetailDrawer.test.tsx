import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import DetailDrawer from '../DetailDrawer'

// The lg+ classes that dock the panel into a parent grid. Their presence is the
// whole difference between the two modes, so the test names them once.
const DOCKS_INLINE_AT_LG = 'lg:relative'

function renderDrawer(props: Partial<Parameters<typeof DetailDrawer>[0]> = {}) {
  return render(
    <DetailDrawer isOpen onClose={vi.fn()} ariaLabel="Detail panel" {...props}>
      <p>panel body</p>
    </DetailDrawer>,
  )
}

describe('DetailDrawer', () => {
  it('docks inline at lg+ by default — the four grid screens are unaffected', () => {
    renderDrawer()

    const panel = screen.getByRole('region', { name: 'Detail panel' })
    expect(panel.className).toContain(DOCKS_INLINE_AT_LG)
    expect(panel.className).toContain('lg:pointer-events-auto')
    // The backdrop and ✕ stay below-lg-only in this mode.
    expect(document.querySelector('[aria-hidden="true"]')?.className).toContain('lg:hidden')
    expect(screen.getByLabelText('Close detail panel').className).toContain('lg:hidden')
  })

  it('stays a fixed overlay at every width when alwaysOverlay is set', () => {
    renderDrawer({ alwaysOverlay: true })

    const panel = screen.getByRole('region', { name: 'Detail panel' })
    expect(panel.className).toContain('fixed')
    expect(panel.className).not.toContain(DOCKS_INLINE_AT_LG)
    // Backdrop and ✕ must survive at lg+ too — they are the only way out of an
    // overlay that never docks.
    expect(document.querySelector('[aria-hidden="true"]')?.className).not.toContain('lg:hidden')
    expect(screen.getByLabelText('Close detail panel').className).not.toContain('lg:hidden')
  })

  it('closes on Escape, on the backdrop, and on the ✕ — in both modes', () => {
    const onClose = vi.fn()
    const { unmount } = renderDrawer({ onClose })

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('[aria-hidden="true"]') as HTMLElement)
    fireEvent.click(screen.getByLabelText('Close detail panel'))
    expect(onClose).toHaveBeenCalledTimes(3)

    unmount()
    onClose.mockClear()
    renderDrawer({ onClose, alwaysOverlay: true })

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('[aria-hidden="true"]') as HTMLElement)
    fireEvent.click(screen.getByLabelText('Close detail panel'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('ignores keys other than Escape, and Escape while closed', () => {
    const onClose = vi.fn()
    const { unmount } = renderDrawer({ onClose })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()

    unmount()
    renderDrawer({ onClose, isOpen: false })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
