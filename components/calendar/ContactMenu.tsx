'use client'

import { useCallback, useRef, useState } from 'react'
import { useDismissOnOutsideOrEsc } from '@/lib/hooks/useDismissOnOutsideOrEsc'
import { hasAnyChannel } from '@/lib/contact-links'
import { ChannelItems, ContactRow } from './ContactMenuParts'
import { ContactMenuTrigger } from './ContactMenuTrigger'
import type { CalendarContact } from '@/db/queries/calendar'

interface ContactMenuProps {
  contacts: CalendarContact[]
  /**
   * Reports the menu opening and closing. The production-card popup uses it to
   * stand down its own Escape handler while this menu is up — see
   * `useNestedDialog`.
   */
  onOpenChange: (open: boolean) => void
}

/**
 * Open state, expansion state and dismissal for the menu, kept out of the
 * component so the render stays inside the 50-line function cap (CQ-01).
 *
 * Escape closes the menu and stops there. The popup behind it is already
 * standing down (it was told `onOpenChange(true)`), so the next press closes the
 * popup — the same two-step the confirm dialogs produce. The dismissing press is
 * deliberately *not* swallowed, unlike the dashboard speed dial's: this menu
 * only ever opens inside a modal panel, so the tap that closes it has nothing
 * behind it worth protecting.
 */
function useContactMenu(onOpenChange: (open: boolean) => void) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  useDismissOnOutsideOrEsc(open, wrapperRef, close, { pointerEvent: 'pointerdown' })

  return { open, expandedId, setExpandedId, wrapperRef, setMenuOpen, close }
}

/**
 * The Contact menu on the production-card popup: reach the people on this
 * order's customer by text or email without leaving the calendar.
 *
 * The trigger greys out on "no usable channel" rather than "no contacts", and
 * that is deliberate — a contact row carrying neither an email nor a phone is
 * the same dead end as having no contacts at all, so offering a menu that can
 * only show two disabled rows would be a promise the data cannot keep. There is
 * no host-driven `disabled`: the menu only reads, so unlike the popup's pills it
 * stays usable while a mutation is in flight, and a prop whose only call site
 * hardcoded `false` was a contract no caller could exercise.
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
export default function ContactMenu({ contacts, onOpenChange }: ContactMenuProps) {
  const { open, expandedId, setExpandedId, wrapperRef, setMenuOpen, close } =
    useContactMenu(onOpenChange)

  return (
    // `relative` anchors the panel; `shrink-0` because this wrapper — not the
    // button inside it — is the flex item in the status block's nowrap row.
    <div ref={wrapperRef} className="relative shrink-0">
      <ContactMenuTrigger
        open={open}
        disabled={!hasAnyChannel(contacts)}
        onToggle={() => setMenuOpen(!open)}
      />

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
