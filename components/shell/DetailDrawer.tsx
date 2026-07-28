'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface DetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  ariaLabel: string
  /**
   * Keep the fixed slide-over at every breakpoint instead of docking inline at
   * lg+. For hosts that are not a two-panel grid. Defaults to false, which is
   * the original responsive behaviour.
   */
  alwaysOverlay?: boolean
  children: React.ReactNode
}

// The lg+ "dock into the parent grid" half of the responsive behaviour. Lifted
// into a constant so `alwaysOverlay` can drop it wholesale rather than
// duplicating the class list across two branches.
const DOCK_INLINE_AT_LG =
  'lg:relative lg:inset-auto lg:w-auto lg:max-w-none lg:shadow-none ' +
  'lg:transform-none lg:translate-x-0 lg:transition-none lg:z-auto ' +
  'lg:pointer-events-auto'

/**
 * Responsive container for the right-hand "detail" panel of the two-panel
 * screens (Customers, Orders, Leads, Invoices).
 *
 * - lg+ (≥1024px): renders inline as a normal flow element so the parent grid
 *   places it in its column. No transform, no overlay, no animation. The
 *   `isOpen` state is irrelevant — the section is always visible inline; what
 *   it shows is decided by the children (detail vs empty-state).
 * - <lg: renders as a fixed slide-over from the right with a backdrop and
 *   close button. Slides via CSS `translate-x` + transition. Closes on
 *   backdrop click, the ✕ button, or Escape.
 *
 * `alwaysOverlay` suppresses the first bullet and keeps the slide-over at every
 * width. The production calendar needs this: its root is a fixed-height
 * `overflow-hidden` column that must never scroll as a page (CONSTRAINT-19), so
 * a panel docking into it inline at lg+ would either be clipped or force the
 * page to scroll. It is opt-in precisely so the four grid-based consumers keep
 * their behaviour unchanged.
 *
 * CSS-only — no JS media-query detection (avoids SSR hydration mismatch).
 *
 * The parent layout is responsible for setting `lg:grid lg:grid-cols-...` on
 * its container so the section docks into the grid at lg+. Below lg the
 * section is `position: fixed` and does not affect document flow, so the
 * parent should be a single-column block in that range.
 */
export default function DetailDrawer({
  isOpen,
  onClose,
  ariaLabel,
  alwaysOverlay = false,
  children,
}: DetailDrawerProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 bg-black/40 z-40 ${
          alwaysOverlay ? '' : 'lg:hidden '
        }transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <section
        aria-label={ariaLabel}
        className={`
          fixed inset-y-0 right-0 z-50 w-[92%] max-w-[600px]
          bg-app-bg overflow-y-auto shadow-xl
          transform transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
          ${alwaysOverlay ? '' : DOCK_INLINE_AT_LG}
        `.trim().replace(/\s+/g, ' ')}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className={`${
            alwaysOverlay ? '' : 'lg:hidden '
          }absolute top-3 right-3 z-10 p-2 rounded-md hover:bg-muted min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground`}
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </section>
    </>
  )
}
