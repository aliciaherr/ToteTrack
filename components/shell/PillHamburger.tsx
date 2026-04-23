'use client'

import { Menu } from 'lucide-react'

interface PillHamburgerProps {
  onClick: () => void
}

/**
 * Fixed-position pill-contained hamburger button rendered top-left on every
 * authenticated screen. Sole chrome element on `app/(app)/*` routes —
 * tapping it opens the slide-over NavDrawer.
 *
 * Size is 44×44px (touch-target minimum). Position is `top-6 left-6`
 * (24px from viewport edges, aligned with page content gutter).
 */
export default function PillHamburger({ onClick }: PillHamburgerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open navigation"
      className="fixed top-6 left-6 z-40 flex items-center justify-center w-11 h-11 rounded-full bg-card shadow-md hover:shadow-lg transition-shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Menu className="h-5 w-5 text-secondary" aria-hidden="true" />
    </button>
  )
}
