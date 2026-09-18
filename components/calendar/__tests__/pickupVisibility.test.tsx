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
  CALENDAR_VIEW_ORDER,
  DEFAULT_CALENDAR_VIEW,
  DEFAULT_CALENDAR_VISIBILITY,
  PickupVisibilityProvider,
  nextCalendarView,
  useCalendarVisibility,
  visibilityForView,
} from '../pickupVisibility'
import { useCalendarVisibilityState } from '../calendarLayoutHooks'

/** Reads the context and exposes the view, both flags and the cycle. */
function VisibilityProbe() {
  const { view, showOrders, showPickups, cycleView } = useCalendarVisibility()
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="orders">{String(showOrders)}</span>
      <span data-testid="pickups">{String(showPickups)}</span>
      <button type="button" onClick={cycleView}>
        cycle
      </button>
    </div>
  )
}

describe('visibilityForView', () => {
  it('maps each view to the lists it draws', () => {
    expect(visibilityForView('orders')).toEqual({ showOrders: true, showPickups: false })
    expect(visibilityForView('pickups')).toEqual({ showOrders: false, showPickups: true })
    expect(visibilityForView('both')).toEqual({ showOrders: true, showPickups: true })
  })

  it('never yields a view with neither list drawn', () => {
    // The point of the enum (Task 93): the old pair of booleans could reach
    // both-off, and every day column carried a message for that state. No view
    // maps to it any more, so the state is unreachable rather than discouraged.
    for (const view of CALENDAR_VIEW_ORDER) {
      const { showOrders, showPickups } = visibilityForView(view)
      expect(showOrders || showPickups).toBe(true)
    }
  })
})

describe('nextCalendarView', () => {
  it('advances through the documented order', () => {
    expect(nextCalendarView('orders')).toBe('pickups')
    expect(nextCalendarView('pickups')).toBe('both')
  })

  it('wraps from the last view back to the first', () => {
    expect(nextCalendarView('both')).toBe('orders')
  })
})

describe('pickupVisibility', () => {
  it('defaults to the orders view', () => {
    render(<VisibilityProbe />)

    expect(screen.getByTestId('view')).toHaveTextContent('orders')
    expect(screen.getByTestId('orders')).toHaveTextContent('true')
    expect(screen.getByTestId('pickups')).toHaveTextContent('false')
    expect(DEFAULT_CALENDAR_VIEW).toBe('orders')
    expect(DEFAULT_CALENDAR_VISIBILITY).toEqual({ showOrders: true, showPickups: false })
  })

  it('is inert outside a provider — the cycle is a no-op, not a crash', () => {
    // A day column rendered outside a calendar (every DayColumn test does this)
    // must still draw the orders list it always drew.
    render(<VisibilityProbe />)

    fireEvent.click(screen.getByText('cycle'))

    expect(screen.getByTestId('view')).toHaveTextContent('orders')
    expect(screen.getByTestId('pickups')).toHaveTextContent('false')
  })

  it('serves whatever the provider holds', () => {
    render(
      <PickupVisibilityProvider
        value={{
          view: 'pickups',
          ...visibilityForView('pickups'),
          cycleView: () => {},
          setView: () => {},
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
    act(() => first.result.current.cycleView())
    expect(first.result.current.view).toBe('pickups')
    first.unmount()

    // A second visit is a fresh mount, which is the whole reset mechanism
    // (CONSTRAINT-25).
    const second = renderHook(() => useCalendarVisibilityState())
    expect(second.result.current.view).toBe('orders')
    expect(second.result.current.showPickups).toBe(false)
    expect(second.result.current.showOrders).toBe(true)
  })

  it('cycles through all three views and back to the first', () => {
    const { result } = renderHook(() => useCalendarVisibilityState())

    act(() => result.current.cycleView())
    expect(result.current.view).toBe('pickups')
    expect(result.current.showOrders).toBe(false)

    act(() => result.current.cycleView())
    expect(result.current.view).toBe('both')
    expect(result.current.showOrders).toBe(true)
    expect(result.current.showPickups).toBe(true)

    act(() => result.current.cycleView())
    expect(result.current.view).toBe('orders')
  })

  it('jumps straight to a view when search reveals a hidden group', () => {
    const { result } = renderHook(() => useCalendarVisibilityState())

    act(() => result.current.cycleView())
    expect(result.current.showOrders).toBe(false)

    act(() => result.current.setView('orders'))

    expect(result.current.view).toBe('orders')
    expect(result.current.showOrders).toBe(true)
  })
})
