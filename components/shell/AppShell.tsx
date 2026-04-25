'use client'

import { useState, useCallback } from 'react'
import PillHamburger from './PillHamburger'
import NavDrawer from './NavDrawer'
import { DrawerStateProvider } from './drawer-state'

/**
 * Root shell for all authenticated routes under `app/(app)/`. Owns drawer-open
 * state and mounts the chrome: the fixed pill-hamburger button (top-left) and
 * the Framer Motion slide-over NavDrawer that the button triggers.
 *
 * Children are wrapped in `DrawerStateProvider` so descendant client components
 * (e.g., the dashboard QuickAddFab) can read drawer-open state without
 * prop-drilling.
 *
 * The `pt-3` on main keeps a thin 12px buffer at the very top so content
 * shares the same horizontal band as the pill (which sits at top-6/left-6,
 * 44×44px → occupies y=24–68px). Pages are responsible for left-padding
 * their first row enough to clear the pill horizontally (~80px from the
 * viewport edge).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  return (
    <div className="min-h-screen bg-app-bg">
      <PillHamburger onClick={openDrawer} />
      <NavDrawer isOpen={isDrawerOpen} onClose={closeDrawer} />
      <DrawerStateProvider isOpen={isDrawerOpen}>
        <main className="pt-3">{children}</main>
      </DrawerStateProvider>
    </div>
  )
}
