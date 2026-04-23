'use client'

import { createContext, useContext } from 'react'

interface DrawerState {
  isOpen: boolean
}

const DrawerStateContext = createContext<DrawerState>({ isOpen: false })

/**
 * Provides the AppShell's nav-drawer open/close state to descendant client
 * components. Wraps `<main>` so dashboard widgets and the QuickAddFab can
 * react to drawer open/close events without prop-drilling.
 */
export function DrawerStateProvider({
  isOpen,
  children,
}: {
  isOpen: boolean
  children: React.ReactNode
}) {
  return (
    <DrawerStateContext.Provider value={{ isOpen }}>
      {children}
    </DrawerStateContext.Provider>
  )
}

/**
 * Read the AppShell nav-drawer open/close state from any descendant client
 * component. Returns `{ isOpen: false }` when called outside an AppShell —
 * consumers like QuickAddFab rely on this default in test/storybook contexts
 * where the shell isn't mounted.
 */
export function useAppShellDrawerState(): DrawerState {
  return useContext(DrawerStateContext)
}
