'use client'

import { useState, useCallback } from 'react'
import TopBar from './TopBar'
import NavDrawer from './NavDrawer'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  return (
    <div className="min-h-screen bg-app-bg">
      <TopBar onMenuClick={openDrawer} />
      <NavDrawer isOpen={isDrawerOpen} onClose={closeDrawer} />
      <main className="pt-14">{children}</main>
    </div>
  )
}
