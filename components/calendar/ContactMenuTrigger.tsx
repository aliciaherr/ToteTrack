'use client'

import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// `ContactMenu`'s trigger button. Its own sibling rather than more of
// `ContactMenuParts` — that file is already ~170 lines and this would push it
// through the 200-line component cap (CQ-02) — and its own function rather than
// more of `ContactMenu`, which was over the 50-line function cap (CQ-01).

/**
 * The button that opens the Contact menu.
 *
 * Disabled state carries a `title` rather than staying silent: a greyed control
 * with no explanation reads as a bug, and the reason ("no contact details on
 * file") is the one thing the operator can act on — by filling the customer in.
 *
 * `min-h-[44px]` and `shrink-0` are not cosmetic: this button shares a
 * `flex-nowrap` row with the status buttons inside the calendar popup, so it
 * must neither shrink below the touch-target floor nor squeeze its neighbours.
 *
 * @param open Whether the menu is showing; drives `aria-expanded` and the
 * chevron's 180° flip.
 * @param disabled True when there is no channel to offer.
 * @param onToggle Opens or closes the menu.
 */
export function ContactMenuTrigger({
  open,
  disabled,
  onToggle,
}: {
  open: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      title={disabled ? 'No contact details on file' : undefined}
      onClick={onToggle}
      className="min-h-[44px] shrink-0"
    >
      Contact
      <ChevronDown
        aria-hidden="true"
        className={cn('size-4 transition-transform duration-200', open && 'rotate-180')}
      />
    </Button>
  )
}
