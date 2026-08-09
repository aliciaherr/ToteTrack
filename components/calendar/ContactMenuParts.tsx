'use client'

import { ChevronRight, Mail, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isPresent, isReachable, mailtoHref, smsHref } from '@/lib/contact-links'
import type { CalendarContact } from '@/db/queries/calendar'

// The rows inside `ContactMenu`'s panel. Its own sibling so both files stay
// inside the 200-line component cap (CQ-02), matching the folder's existing
// `*Parts` idiom.

/** Shared geometry for every row in the panel — 44px is the touch-target floor. */
const ROW = 'flex w-full items-center gap-2 min-h-[44px] rounded-md px-3 text-sm text-left'

/**
 * One reachable channel.
 *
 * A present channel is an `<a>` so the OS handler opens on tap and the row is
 * keyboard-reachable; an absent one is a disabled `<button>`. What is banned
 * here is `href={undefined}` — an anchor without an href is not focusable, reads
 * as plain text to a screen reader, and silently does nothing when tapped, which
 * is indistinguishable from the app being broken.
 *
 * An href whose *target* is empty is a different thing and is allowed: a stored
 * `'call the yard'` passes `isPresent`, so `smsHref` yields a bare `sms:` and
 * this renders a real, focusable anchor that opens the messaging app with an
 * empty To field. That is the intended outcome — the operator finishes the job
 * by hand, the same bargain `mailtoHref` makes with a malformed address.
 *
 * @param label Visible text and accessible name.
 * @param icon The lucide glyph for this channel.
 * @param href The built href, or null when the channel is not on file.
 * @param indented True when the row sits under a contact header in the picker.
 * @param onChoose Called when a live channel is picked; closes the menu.
 */
function ChannelItem({
  label,
  icon: Icon,
  href,
  indented,
  onChoose,
}: {
  label: string
  icon: typeof Mail
  href: string | null
  indented: boolean
  onChoose: () => void
}) {
  const indent = indented ? 'pl-6' : undefined

  if (!href) {
    return (
      <button
        type="button"
        role="menuitem"
        disabled
        aria-disabled="true"
        className={cn(ROW, indent, 'text-muted-foreground opacity-50 cursor-not-allowed')}
      >
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </button>
    )
  }

  return (
    <a
      href={href}
      role="menuitem"
      onClick={onChoose}
      className={cn(
        ROW,
        indent,
        'hover:bg-muted focus-visible:outline-none focus-visible:bg-muted',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </a>
  )
}

/**
 * Both channels for one contact, Message before Email — texting a driver gets a
 * reply faster than mailing them, and this menu is used from the shop floor.
 *
 * @param contact The contact whose phone and email become the two rows; either
 * column may be absent, which renders that row disabled.
 * @param indented True when these rows sit under a contact header in the picker,
 * false when this contact is the order's only one and the rows are top level.
 * @param onChoose Called when either channel is picked; closes the menu.
 */
export function ChannelItems({
  contact,
  indented,
  onChoose,
}: {
  contact: CalendarContact
  indented: boolean
  onChoose: () => void
}) {
  return (
    <>
      <ChannelItem
        label="Message"
        icon={MessageSquare}
        href={isPresent(contact.phone) ? smsHref(contact.phone) : null}
        indented={indented}
        onChoose={onChoose}
      />
      <ChannelItem
        label="Email"
        icon={Mail}
        href={isPresent(contact.email) ? mailtoHref(contact.email) : null}
        indented={indented}
        onChoose={onChoose}
      />
    </>
  )
}

/**
 * One contact in the picker: an accordion header that reveals its two channels.
 *
 * A contact with neither channel is disabled rather than hidden — dropping the
 * row would make the list disagree with the order's real contact set, and
 * "Dave is here but unreachable" is the honest reading.
 *
 * @param contact The contact to head this section.
 * @param expanded Whether this contact's channels are showing.
 * @param onToggle Requests expansion; the parent collapses whichever was open.
 * @param onChoose Called when one of the revealed channels is picked.
 */
export function ContactRow({
  contact,
  expanded,
  onToggle,
  onChoose,
}: {
  contact: CalendarContact
  expanded: boolean
  onToggle: () => void
  onChoose: () => void
}) {
  const reachable = isReachable(contact)

  return (
    // `role="none"` because this wrapper sits directly inside `role="menu"`: an
    // untyped `<div>` between them breaks the menu→menuitem chain, and a screen
    // reader stops counting the rows as menu items.
    <div role="none">
      <button
        type="button"
        role="menuitem"
        disabled={!reachable}
        aria-disabled={!reachable}
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          ROW,
          'font-medium',
          reachable
            ? 'hover:bg-muted focus-visible:outline-none focus-visible:bg-muted'
            : 'text-muted-foreground opacity-50 cursor-not-allowed',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 transition-transform duration-200', expanded && 'rotate-90')}
        />
        <span className="truncate">{contact.name}</span>
      </button>
      {expanded && <ChannelItems contact={contact} indented onChoose={onChoose} />}
    </div>
  )
}
