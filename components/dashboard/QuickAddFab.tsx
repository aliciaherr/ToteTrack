'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Plus, Package, UserPlus, Target, type LucideIcon } from 'lucide-react'
import {
  speedDialFabVariants,
  speedDialContainerVariants,
  speedDialOptionVariants,
} from '@/lib/animations'
import { useAppShellDrawerState } from '@/components/shell/drawer-state'

interface QuickAddOption {
  id: string
  label: string
  icon: LucideIcon
  href: string
}

const OPTIONS: readonly QuickAddOption[] = [
  { id: 'new-order', label: 'Add Purchase Order', icon: Package, href: '/orders?new=1' },
  { id: 'new-customer', label: 'Add Customer', icon: UserPlus, href: '/customers?new=1' },
  { id: 'new-lead', label: 'Add Lead', icon: Target, href: '/leads?new=1' },
]

/**
 * Closes the menu when the user mouses down outside `containerRef` or presses
 * Esc. Mousedown uses capture phase + preventDefault so the dismissing tap
 * does not also activate the element behind the menu.
 */
function useDismissOnOutsideOrEsc(
  isOpen: boolean,
  containerRef: React.RefObject<HTMLElement>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!isOpen) return
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, containerRef, onDismiss])
}

interface FabOptionProps {
  option: QuickAddOption
  onSelect: (href: string) => void
  shouldReduceMotion: boolean
}

function FabOption({ option, onSelect, shouldReduceMotion }: FabOptionProps) {
  const Icon = option.icon
  return (
    <motion.li
      role="none"
      className="list-none"
      variants={shouldReduceMotion ? undefined : speedDialOptionVariants}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelect(option.href)}
        className="flex items-center gap-3 group focus-visible:outline-none"
      >
        <span className="rounded-md bg-card shadow-md text-sm px-3 py-2 text-secondary group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring transition-colors">
          {option.label}
        </span>
        <span className="flex items-center justify-center w-11 h-11 rounded-full bg-card shadow-md text-secondary group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring transition-colors">
          <Icon className="h-5 w-5" aria-hidden={true} />
        </span>
      </button>
    </motion.li>
  )
}

/**
 * Dashboard-only speed-dial FAB. Tapping the "+" button rotates it 45° (to "×")
 * and fans three options vertically upward (Purchase Order, Customer, Lead).
 * Tapping an option navigates to the destination screen with `?new=1` to
 * pre-open the create form.
 *
 * Hides itself when the AppShell nav drawer is open. Dismisses on tap-outside,
 * Esc key, or another tap on the "+/×" button. Tap-outside uses mousedown
 * capture to suppress activation of the element behind on the dismissing tap.
 */
export default function QuickAddFab() {
  const router = useRouter()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { isOpen: isDrawerOpen } = useAppShellDrawerState()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])
  const close = useCallback(() => setIsOpen(false), [])

  const handleSelect = useCallback(
    (href: string) => {
      setIsOpen(false)
      router.push(href)
    },
    [router],
  )

  useDismissOnOutsideOrEsc(isOpen, containerRef, close)

  if (isDrawerOpen) return null

  return (
    <div
      ref={containerRef}
      className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3"
    >
      <AnimatePresence>
        {isOpen && (
          <motion.ul
            role="menu"
            aria-label="Quick add options"
            className="flex flex-col items-end gap-3 m-0 p-0"
            initial="closed"
            animate="open"
            exit="closed"
            variants={shouldReduceMotion ? undefined : speedDialContainerVariants}
          >
            {OPTIONS.map((option) => (
              <FabOption
                key={option.id}
                option={option}
                onSelect={handleSelect}
                shouldReduceMotion={shouldReduceMotion}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={toggle}
        aria-label={isOpen ? 'Close quick add menu' : 'Quick add'}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center justify-center w-[52px] h-[52px] rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      >
        <motion.span
          variants={shouldReduceMotion ? undefined : speedDialFabVariants}
          animate={isOpen ? 'open' : 'closed'}
          className="flex"
        >
          <Plus className="h-6 w-6" aria-hidden={true} />
        </motion.span>
      </button>
    </div>
  )
}
