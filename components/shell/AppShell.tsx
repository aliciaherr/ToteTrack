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
 * The `pt-16` on main provides clearance for the pill (which sits at
 * top-6/left-6, 44×44px → ends at y=68px) so page content below it doesn't
 * collide with the button on its first heading.
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
        <main className="pt-16">{children}</main>
      </DrawerStateProvider>
    </div>
  )
}
