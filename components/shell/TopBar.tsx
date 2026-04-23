'use client'

import { Menu, Search, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TopBarProps {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-card border-b border-border flex items-center px-4 gap-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="min-w-[44px] min-h-[44px]"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <span className="font-semibold text-foreground text-lg tracking-tight select-none">
        ToteTrack
      </span>

      <div className="flex-1 max-w-sm mx-auto relative hidden sm:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          placeholder="Search..."
          className="w-full pl-9 pr-4 h-9 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <Button
          variant="ghost"
          size="icon"
          className="min-w-[44px] min-h-[44px]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </Button>
        <div
          className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium select-none"
          aria-label="User avatar"
        >
          S
        </div>
      </div>
    </header>
  )
}
