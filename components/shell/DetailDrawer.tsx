'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface DetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  ariaLabel: string
  children: React.ReactNode
}

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
        className={`fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity duration-200 ${
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
          lg:relative lg:inset-auto lg:w-auto lg:max-w-none lg:shadow-none
          lg:transform-none lg:translate-x-0 lg:transition-none lg:z-auto
          lg:pointer-events-auto
        `.trim().replace(/\s+/g, ' ')}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="lg:hidden absolute top-3 right-3 z-10 p-2 rounded-md hover:bg-muted min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </section>
    </>
  )
}
