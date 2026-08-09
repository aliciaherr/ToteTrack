'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hasAnyChannel } from './contactLinks'
import { ChannelItems, ContactRow } from './ContactMenuParts'
import type { CalendarContact } from '@/db/queries/calendar'

interface ContactMenuProps {
  contacts: CalendarContact[]
  /** True while a popup mutation is in flight. */
  disabled: boolean
  /**
   * Reports the menu opening and closing. The production-card popup uses it to
   * stand down its own Escape handler while this menu is up — see
   * `useNestedDialog`.
   */
  onOpenChange: (open: boolean) => void
}

/**
 * The Contact menu on the production-card popup: reach the people on this
 * order's customer by text or email without leaving the calendar.
 *
 * The trigger greys out on "no usable channel" rather than "no contacts", and
 * that is deliberate — a contact row carrying neither an email nor a phone is
 * the same dead end as having no contacts at all, so offering a menu that can
 * only show two disabled rows would be a promise the data cannot keep.
 *
 * The panel is absolutely positioned and left-aligned at 220px so it cannot
 * clip horizontally inside the popup's ~400px usable width. It overlays the
 * content below it; that is intended — the menu is transient and the status
 * block it covers is not readable-while-choosing anyway.
 *
 * The panel is **not** `role="dialog"`. `useFocusTrap` shrinks the popup's tab
 * ring to the first `[role="dialog"]` it finds inside the panel, and a menu
 * claiming that role would hijack a trap meant for the confirm dialogs.
 */
export default function ContactMenu({ contacts, disabled, onOpenChange }: ContactMenuProps) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isDisabled = disabled || !hasAnyChannel(contacts)

  const setMenuOpen = useCallback(
    (next: boolean) => {
      setOpen(next)
      // Collapsing on close means reopening always starts from the picker,
      // rather than resuming whichever contact was last inspected.
      if (!next) setExpandedId(null)
      onOpenChange(next)
    },
    [onOpenChange],
  )

  const close = useCallback(() => setMenuOpen(false), [setMenuOpen])

  useEffect(() => {
    if (!open) return

    // Escape closes the menu and stops there. The popup behind it is already
    // standing down (it was told `onOpenChange(true)`), so the next press
    // closes the popup — the same two-step the confirm dialogs produce.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) close()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open, close])

  return (
    // `relative` anchors the panel; `shrink-0` because this wrapper — not the
    // button inside it — is the flex item in the status block's nowrap row.
    <div ref={wrapperRef} className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isDisabled}
        title={isDisabled ? 'No contact details on file' : undefined}
        onClick={() => setMenuOpen(!open)}
        className="min-h-[44px] shrink-0"
      >
        Contact
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 transition-transform duration-200', open && 'rotate-180')}
        />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Contact"
          data-testid="contact-menu"
          className="absolute top-full left-0 mt-1 z-10 min-w-[220px] rounded-lg border border-border bg-card shadow-lg p-1"
        >
          {contacts.length === 1 ? (
            // One contact is not a choice. Making the user expand a picker of
            // one to reach the only two actions is a step that decides nothing.
            <ChannelItems contact={contacts[0]} indented={false} onChoose={close} />
          ) : (
            contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                expanded={expandedId === contact.id}
                onToggle={() =>
                  setExpandedId((current) => (current === contact.id ? null : contact.id))
                }
                onChoose={close}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
