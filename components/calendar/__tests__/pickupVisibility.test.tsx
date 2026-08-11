import { render, screen, fireEvent, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/actions/pickups', () => ({ updatePickup: vi.fn() }))
vi.mock('@/lib/actions/calendar', () => ({
  setProductionPlacement: vi.fn(),
  clearProductionPlacement: vi.fn(),
  toggleBackhaul: vi.fn(),
  toggleSameDayDelivery: vi.fn(),
}))

import {
  DEFAULT_CALENDAR_VISIBILITY,
  PickupVisibilityProvider,
  useCalendarVisibility,
} from '../pickupVisibility'
import { useCalendarVisibilityState } from '../calendarLayoutHooks'

/** Reads the context and exposes both flags plus their toggles. */
function VisibilityProbe() {
  const { showOrders, showPickups, toggleOrders, togglePickups } = useCalendarVisibility()
  return (
    <div>
      <span data-testid="orders">{String(showOrders)}</span>
      <span data-testid="pickups">{String(showPickups)}</span>
      <button type="button" onClick={toggleOrders}>
        flip-orders
      </button>
      <button type="button" onClick={togglePickups}>
        flip-pickups
      </button>
    </div>
  )
}

describe('pickupVisibility', () => {
  it('defaults to orders-on and pickups-off', () => {
    render(<VisibilityProbe />)

    expect(screen.getByTestId('orders')).toHaveTextContent('true')
    expect(screen.getByTestId('pickups')).toHaveTextContent('false')
    expect(DEFAULT_CALENDAR_VISIBILITY).toEqual({ showOrders: true, showPickups: false })
  })

  it('is inert outside a provider — the toggles are no-ops, not crashes', () => {
    // A day column rendered outside a calendar (every DayColumn test does this)
    // must still draw the orders list it always drew.
    render(<VisibilityProbe />)

    fireEvent.click(screen.getByText('flip-pickups'))

    expect(screen.getByTestId('pickups')).toHaveTextContent('false')
  })

  it('serves whatever the provider holds', () => {
    render(
      <PickupVisibilityProvider
        value={{
          showOrders: false,
          showPickups: true,
          toggleOrders: () => {},
          togglePickups: () => {},
        }}
      >
        <VisibilityProbe />
      </PickupVisibilityProvider>,
    )

    expect(screen.getByTestId('orders')).toHaveTextContent('false')
    expect(screen.getByTestId('pickups')).toHaveTextContent('true')
  })
})

describe('useCalendarVisibilityState', () => {
  it('starts at the documented default on every mount — nothing is persisted', () => {
    const first = renderHook(() => useCalendarVisibilityState())
    act(() => first.result.current.togglePickups())
    expect(first.result.current.showPickups).toBe(true)
    first.unmount()

    // A second visit is a fresh mount, which is the whole reset mechanism
    // (CONSTRAINT-25).
    const second = renderHook(() => useCalendarVisibilityState())
    expect(second.result.current.showPickups).toBe(false)
    expect(second.result.current.showOrders).toBe(true)
  })

  it('flips each group independently', () => {
    const { result } = renderHook(() => useCalendarVisibilityState())

    act(() => result.current.toggleOrders())

    expect(result.current.showOrders).toBe(false)
    expect(result.current.showPickups).toBe(false)

    act(() => result.current.togglePickups())

    expect(result.current.showOrders).toBe(false)
    expect(result.current.showPickups).toBe(true)
  })
})
