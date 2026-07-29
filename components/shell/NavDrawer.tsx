'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Package,
  CalendarDays,
  Target,
  Receipt,
  HelpCircle,
  LogOut,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

const DRAWER_WIDTH = 280 // px — must match the w-[280px] class on the panel

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Orders', href: '/orders', icon: Package },
  // Calendar sits directly after Orders: it is a view *of* orders, so the two
  // read as a pair before the drawer moves on to Leads and billing.
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Leads', href: '/leads', icon: Target },
  { label: 'Invoices', href: '/invoices', icon: Receipt },
  { label: 'Support', href: '/support', icon: HelpCircle },
]

interface NavDrawerProps {
  isOpen: boolean
  onClose: () => void
}

function buildVariants(shouldReduceMotion: boolean | null) {
  return {
    drawer: {
      hidden: { x: shouldReduceMotion ? 0 : -DRAWER_WIDTH },
      visible: { x: 0, transition: { duration: shouldReduceMotion ? 0 : 0.2, ease: 'easeOut' as const } },
      exit: { x: shouldReduceMotion ? 0 : -DRAWER_WIDTH, transition: { duration: shouldReduceMotion ? 0 : 0.15, ease: 'easeIn' as const } },
    },
    backdrop: {
      hidden: { opacity: 0 },
      visible: { opacity: 0.4, transition: { duration: shouldReduceMotion ? 0 : 0.2 } },
      exit: { opacity: 0, transition: { duration: shouldReduceMotion ? 0 : 0.15 } },
    },
  }
}

function NavItemList({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  return (
    <ul className="flex-1 py-4 overflow-y-auto" role="list">
      {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 py-3 min-h-[44px] text-sm transition-colors ${
                isActive
                  ? 'border-l-2 border-primary font-medium text-primary bg-primary/5 pl-[14px] pr-4'
                  : 'pl-4 pr-4 text-secondary hover:bg-muted'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function SignOutRow() {
  const { toast } = useToast()
  const [isSigningOut, setIsSigningOut] = useState(false)

  // `signOut` returns `{ error }` on an auth-service failure instead of
  // redirecting (audit L-02) — a plain form action would discard it, so the
  // click handler awaits the action and toasts the error (same shape as
  // `useCustomerAddresses`/`useStatusActions`). A transport-level rejection
  // (offline, stale action id after a deploy) is logged with context and
  // surfaced as the generic failure message — never swallowed (EH-01). On
  // success the server action redirects to /login, so no client navigation
  // happens here.
  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      const result = await signOut()
      if (result?.error) toast(result.error, 'error')
    } catch (cause) {
      console.error('NavDrawer: sign-out failed', { cause })
      toast(GENERIC_FAILURE_MESSAGE, 'error')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="border-t border-border shrink-0">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="flex items-center gap-3 w-full py-3 px-4 min-h-[44px] text-sm text-secondary hover:bg-muted transition-colors disabled:opacity-50"
      >
        <LogOut className="h-5 w-5 shrink-0" />
        Sign Out
      </button>
    </div>
  )
}

export default function NavDrawer({ isOpen, onClose }: NavDrawerProps) {
  const pathname = usePathname()
  const shouldReduceMotion = useReducedMotion()
  const { drawer: drawerVariants, backdrop: backdropVariants } = buildVariants(shouldReduceMotion)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="drawer-backdrop"
            className="fixed inset-0 z-40 bg-black"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={backdropVariants}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.nav
            key="drawer-panel"
            className="fixed top-0 left-0 z-50 h-full w-[280px] bg-card shadow-xl flex flex-col"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={drawerVariants}
            aria-label="Navigation drawer"
          >
            <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
              <span className="font-semibold text-foreground text-lg tracking-tight">ToteTrack</span>
            </div>
            <NavItemList pathname={pathname} onClose={onClose} />
            <SignOutRow />
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  )
}
