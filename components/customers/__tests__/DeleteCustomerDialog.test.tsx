import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => (
          <div {...rest}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

import DeleteCustomerDialog from '../DeleteCustomerDialog'

type ConfirmResult = { success: true } | { error: string }

const COMPANY_NAME = 'Acme Industrial'

/** Typed stand-in for the `onConfirm` prop — the parent's delete handler. */
function makeConfirm() {
  return vi.fn<() => Promise<ConfirmResult>>()
}

beforeEach(() => {
  vi.clearAllMocks()
})

// The EH-01 test spies on `console.error`. Restoring only at the end of that
// test body means a mid-test failure would leave the spy installed and silence
// `console.error` for every test that runs after it in this file.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('DeleteCustomerDialog', () => {
  it('renders nothing when the dialog is closed', () => {
    render(
      <DeleteCustomerDialog
        open={false}
        companyName={COMPANY_NAME}
        onCancel={vi.fn()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the destructive confirmation heading and action buttons when open', () => {
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={vi.fn()}
        onConfirm={makeConfirm()}
      />,
    )
    expect(screen.getByRole('heading', { name: /delete acme industrial\?/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('calls onConfirm once and stays in the submitting state on success', async () => {
    // On success `handleConfirm` returns without clearing `isSubmitting`, so
    // the button stays disabled on "Deleting…" for as long as the dialog is
    // still open. The parent is what ends that state: `CustomerForm.handleDelete`
    // calls `setDeleteOpen(false)` — it does not unmount the dialog — and the
    // resulting close is what runs `useResetOnClose` to clear the flag.
    // This test asserts only the open-and-submitting half of that; the
    // close-clears-the-flag half is covered by the close/reopen test below.
    const onConfirm = makeConfirm()
    onConfirm.mockResolvedValueOnce({ success: true })
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm).toHaveBeenCalledWith()
    expect(await screen.findByRole('button', { name: /deleting/i })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a server error inline and re-enables both buttons when onConfirm returns { error }', async () => {
    const onConfirm = makeConfirm()
    onConfirm.mockResolvedValueOnce({ error: 'Customer has open orders.' })
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/customer has open orders/i)
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled()
  })

  it('calls onCancel and never onConfirm when the user backs out', () => {
    const onCancel = vi.fn()
    const onConfirm = makeConfirm()
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes on Escape while idle', () => {
    const onCancel = vi.fn()
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={onCancel}
        onConfirm={makeConfirm()}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // Covers the `serverError` half of the `useResetOnClose` reset only. The
  // error path already set `isSubmitting` back to false, so asserting the
  // buttons are enabled here would prove nothing — see the next test for the
  // `isSubmitting` half, which arranges a close while a submit is genuinely
  // in flight.
  it('clears a stale error when the dialog is closed and reopened', async () => {
    const onConfirm = makeConfirm()
    onConfirm.mockResolvedValueOnce({ error: 'Customer has open orders.' })
    const props = {
      companyName: COMPANY_NAME,
      onCancel: vi.fn(),
      onConfirm,
    }
    const { rerender } = render(<DeleteCustomerDialog open={true} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    rerender(<DeleteCustomerDialog open={false} {...props} />)
    rerender(<DeleteCustomerDialog open={true} {...props} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a genuinely in-flight isSubmitting when the dialog is closed and reopened', async () => {
    const onConfirm = makeConfirm()
    // Never settles: `isSubmitting` is still true at the moment we close, which
    // is the only arrangement in which the re-enable assertions can fail.
    onConfirm.mockReturnValueOnce(new Promise<ConfirmResult>(() => {}))
    const props = {
      companyName: COMPANY_NAME,
      onCancel: vi.fn(),
      onConfirm,
    }
    const { rerender } = render(<DeleteCustomerDialog open={true} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    expect(await screen.findByRole('button', { name: /deleting/i })).toBeDisabled()

    rerender(<DeleteCustomerDialog open={false} {...props} />)
    rerender(<DeleteCustomerDialog open={true} {...props} />)

    expect(screen.queryByRole('button', { name: /deleting/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled()
  })

  // Regression, EH-01. Found by @code-review 2026-08-16. Before the fix,
  // `handleConfirm` set `isSubmitting` before the await and cleared it only
  // inside the `'error' in result` branch, so a transport-level rejection
  // (offline, stale server-action id after a deploy) escaped the handler: no
  // alert rendered, both buttons stayed disabled, and Escape and
  // backdrop-close are both gated on `isSubmitting` — a permanently wedged
  // modal recoverable only by a page reload, plus an unhandled rejection.
  // `useStatusActions.makeConfirmHandler` absorbs this for the order dialogs;
  // `CustomerForm` has no equivalent, so the dialog now handles it itself.
  it('recovers with an inline error when onConfirm rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onConfirm = makeConfirm()
    onConfirm.mockRejectedValueOnce(new Error('network down'))
    render(
      <DeleteCustomerDialog
        open={true}
        companyName={COMPANY_NAME}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled()
    // The cause must reach the console — never swallowed (EH-01). The message
    // wording is not the contract, so it is matched loosely; `cause` is, so it
    // is matched explicitly. `afterEach` restores the spy.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('delete failed'),
      expect.objectContaining({ companyName: COMPANY_NAME, cause: expect.any(Error) }),
    )
  })
})
