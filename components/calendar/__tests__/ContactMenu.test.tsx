import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ContactMenu from '../ContactMenu'
import type { CalendarContact } from '@/db/queries/calendar'

const DANA: CalendarContact = {
  id: 'contact-dana',
  name: 'Dana Reyes',
  email: 'dana@acme-industrial.test',
  phone: '(555) 010-2030',
}

const MO: CalendarContact = {
  id: 'contact-mo',
  name: 'Mo Okafor',
  email: 'mo@acme-industrial.test',
  phone: '555 010 4050',
}

let onOpenChange: (open: boolean) => void

/**
 * jsdom cannot follow a `mailto:`/`sms:` href and logs a navigation error when
 * an anchor click reaches its default action. The menu item's own handler has
 * already run by the time this fires.
 */
function swallowNavigation(event: MouseEvent) {
  event.preventDefault()
}

function renderMenu(contacts: CalendarContact[], disabled = false) {
  return render(
    <ContactMenu contacts={contacts} disabled={disabled} onOpenChange={onOpenChange} />,
  )
}

/** The Contact trigger. */
function trigger() {
  return screen.getByRole('button', { name: /contact/i })
}

function openMenu() {
  fireEvent.click(trigger())
  return screen.getByTestId('contact-menu')
}

beforeEach(() => {
  vi.clearAllMocks()
  onOpenChange = vi.fn()
  document.addEventListener('click', swallowNavigation)
})

afterEach(() => {
  document.removeEventListener('click', swallowNavigation)
})

describe('ContactMenu — trigger', () => {
  it('is disabled with an explanatory title when there are no contacts', () => {
    renderMenu([])

    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveAttribute('title', 'No contact details on file')
  })

  it('is disabled when contacts exist but none has a usable channel', () => {
    // Greying on "no usable channel" rather than "no contacts": a contact row
    // with neither email nor phone is the same dead end as no contact at all.
    renderMenu([{ id: 'ghost', name: 'Pat Vance', email: '   ', phone: null }])

    expect(trigger()).toBeDisabled()
  })

  it('is disabled while the host reports a mutation in flight', () => {
    renderMenu([DANA], true)

    expect(trigger()).toBeDisabled()
  })

  it('advertises itself as a menu trigger and reports its expanded state', () => {
    renderMenu([DANA])

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')

    openMenu()

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('ContactMenu — one contact', () => {
  it('skips the picker and offers the two channels directly', () => {
    renderMenu([DANA])
    const menu = openMenu()

    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
    expect(within(menu).queryByRole('menuitem', { name: 'Dana Reyes' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: /message/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /email/i })).toBeInTheDocument()
  })

  it('renders a live channel as an anchor carrying the built href', () => {
    renderMenu([DANA])
    const menu = openMenu()

    const message = within(menu).getByRole('menuitem', { name: /message/i })
    expect(message.tagName).toBe('A')
    expect(message).toHaveAttribute('href', 'sms:5550102030')

    const email = within(menu).getByRole('menuitem', { name: /email/i })
    expect(email.tagName).toBe('A')
    expect(email).toHaveAttribute('href', 'mailto:dana@acme-industrial.test')
  })

  it('renders a missing channel as a disabled button, never a dead link', () => {
    renderMenu([{ ...DANA, phone: '  ' }])
    const menu = openMenu()

    const message = within(menu).getByRole('menuitem', { name: /message/i })
    expect(message.tagName).toBe('BUTTON')
    expect(message).toBeDisabled()
    expect(message).toHaveAttribute('aria-disabled', 'true')
    expect(message).not.toHaveAttribute('href')
    expect(within(menu).getByRole('menuitem', { name: /email/i }).tagName).toBe('A')
  })
})

describe('ContactMenu — several contacts', () => {
  it('lists every contact by name and reveals no channels until one is picked', () => {
    renderMenu([DANA, MO])
    const menu = openMenu()

    expect(within(menu).getByRole('menuitem', { name: 'Dana Reyes' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Mo Okafor' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /message/i })).toBeNull()
  })

  it('expanding one contact collapses the other', () => {
    renderMenu([DANA, MO])
    const menu = openMenu()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Dana Reyes' }))
    expect(within(menu).getByRole('menuitem', { name: 'Dana Reyes' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(menu).getByRole('menuitem', { name: /message/i })).toHaveAttribute(
      'href',
      'sms:5550102030',
    )

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mo Okafor' }))
    expect(within(menu).getByRole('menuitem', { name: 'Dana Reyes' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(menu).getByRole('menuitem', { name: 'Mo Okafor' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // Exactly one pair of channel rows is showing, and it belongs to Mo.
    expect(within(menu).getAllByRole('menuitem', { name: /message/i })).toHaveLength(1)
    expect(within(menu).getByRole('menuitem', { name: /message/i })).toHaveAttribute(
      'href',
      'sms:5550104050',
    )
  })

  it('keeps an unreachable contact listed but disabled', () => {
    const ghost: CalendarContact = { id: 'ghost', name: 'Pat Vance', email: null, phone: null }
    renderMenu([DANA, ghost])
    const menu = openMenu()

    const row = within(menu).getByRole('menuitem', { name: 'Pat Vance' })
    expect(row).toBeInTheDocument()
    expect(row).toBeDisabled()
    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('collapses the expanded contact when the menu is reopened', () => {
    renderMenu([DANA, MO])
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Dana Reyes' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    openMenu()

    expect(screen.queryByRole('menuitem', { name: /message/i })).toBeNull()
  })
})

describe('ContactMenu — dismissal', () => {
  it('reports every open and close to the host', () => {
    renderMenu([DANA])

    fireEvent.click(trigger())
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(trigger())
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('closes on Escape and reports it — the popup behind stays open', () => {
    // The host stood down its own Escape handler when told the menu opened, so
    // this press closes the menu only; the next one closes the popup.
    renderMenu([DANA])
    openMenu()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('contact-menu')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('closes on a pointerdown outside the menu', () => {
    renderMenu([DANA])
    openMenu()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByTestId('contact-menu')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('stays open on a pointerdown inside the menu', () => {
    renderMenu([DANA, MO])
    const menu = openMenu()

    fireEvent.pointerDown(within(menu).getByRole('menuitem', { name: 'Dana Reyes' }))

    expect(screen.getByTestId('contact-menu')).toBeInTheDocument()
  })

  it('closes when a channel is chosen', () => {
    renderMenu([DANA])
    const menu = openMenu()

    fireEvent.click(within(menu).getByRole('menuitem', { name: /email/i }))

    expect(screen.queryByTestId('contact-menu')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('drops its listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderMenu([DANA])
    openMenu()

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
