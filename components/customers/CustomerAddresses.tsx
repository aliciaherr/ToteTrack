'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS } from './customerFormSchema'
import { useCustomerAddresses, type CustomerAddressesState } from './useCustomerAddresses'
// Same bound the server actions enforce (lib/actions/customer-addresses.ts).
// Safe to import client-side: orders.validation.ts is not a 'use server' file.
import { DELIVERY_ADDRESS_MAX } from '@/lib/actions/orders.validation'
import type { CustomerAddressOption } from '@/db/queries/customers'

interface CustomerAddressesProps {
  customerId: string
  addresses: CustomerAddressOption[]
}

function AddressEditor({
  initialValue,
  ariaLabel,
  busy,
  onSave,
  onCancel,
}: {
  initialValue: string
  ariaLabel: string
  busy: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initialValue)
  return (
    <div className="space-y-2">
      <textarea
        rows={2}
        maxLength={DELIVERY_ADDRESS_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={ariaLabel}
        className={`${FORM_INPUT_CLASS} h-auto py-2`}
        autoFocus
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="min-h-[44px]">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => onSave(text)}
          disabled={busy || text.trim() === ''}
          className="min-h-[44px]"
        >
          {busy ? 'Saving…' : 'Save Address'}
        </Button>
      </div>
    </div>
  )
}

function DeleteConfirm({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">Delete this address?</span>
      <div className="flex items-center gap-2 shrink-0">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="min-h-[44px]">
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy} className="min-h-[44px]">
          {busy ? 'Deleting…' : 'Yes, Delete'}
        </Button>
      </div>
    </div>
  )
}

function AddressRow({
  entry,
  state,
}: {
  entry: CustomerAddressOption
  state: CustomerAddressesState
}) {
  const { mode, isBusy } = state
  if (mode.type === 'editing' && mode.id === entry.id) {
    return (
      <AddressEditor
        initialValue={entry.address}
        ariaLabel={`Edit address: ${entry.address}`}
        busy={isBusy}
        onSave={(text) => state.submitEdit(entry.id, text)}
        onCancel={state.cancel}
      />
    )
  }
  if (mode.type === 'confirming-delete' && mode.id === entry.id) {
    return (
      <DeleteConfirm
        busy={isBusy}
        onConfirm={() => state.confirmDelete(entry.id)}
        onCancel={state.cancel}
      />
    )
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="flex-1 text-sm text-secondary whitespace-pre-line">{entry.address}</p>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="ghost"
          onClick={() => state.openEdit(entry.id)}
          aria-label={`Edit address: ${entry.address}`}
          className="min-h-[44px]"
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => state.requestDelete(entry.id)}
          aria-label={`Delete address: ${entry.address}`}
          className="min-h-[44px] text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

/**
 * "Delivery Addresses" section of the customer detail panel (Feature 14).
 * Lists the customer's saved addresses most-recently-used first and manages
 * them inline: add (textarea + save), edit per row, and delete behind an
 * inline row-level confirmation. Action `{ error }` results render in the
 * section-level alert; successes toast and refresh the route so the
 * server-rendered list updates.
 */
export default function CustomerAddresses({ customerId, addresses }: CustomerAddressesProps) {
  const state = useCustomerAddresses(customerId)
  return (
    <section aria-label="Delivery Addresses" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          Delivery Addresses
        </h3>
        <Button
          type="button"
          variant="outline"
          onClick={state.openAdd}
          disabled={state.mode.type === 'adding'}
          className="min-h-[44px]"
        >
          + Add Address
        </Button>
      </div>
      {state.errorMessage && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {state.errorMessage}
        </div>
      )}
      {state.mode.type === 'adding' && (
        <div className="rounded-md border border-border bg-card p-3">
          <AddressEditor
            initialValue=""
            ariaLabel="New delivery address"
            busy={state.isBusy}
            onSave={state.submitAdd}
            onCancel={state.cancel}
          />
        </div>
      )}
      {addresses.length === 0 ? (
        state.mode.type !== 'adding' && (
          <p className="text-sm text-muted-foreground">No saved addresses yet.</p>
        )
      ) : (
        <ul className="space-y-2">
          {addresses.map((entry) => (
            <li key={entry.id} className="rounded-md border border-border bg-card p-3">
              <AddressRow entry={entry} state={state} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
