'use client'

import { useState } from 'react'
import { FieldRow, FORM_INPUT_CLASS } from '@/components/shared/formFields'
import type { CustomerChoice, ReviewCustomer } from '@/lib/review/review-fields.types'

interface CustomerChoicesProps {
  /** The matcher's ranked candidates, best first. */
  choices: CustomerChoice[]
  /** Every active customer plus any inactive candidate, for the full select. */
  customers: ReviewCustomer[]
  /** The form's current `customer_id`, '' when none. */
  value: string
  onChoose: (customerId: string) => void
}

function ChoiceLabels({ choice }: { choice: CustomerChoice }) {
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {choice.status === 'inactive' && (
        <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">Inactive</span>
      )}
      {choice.addressMatched && (
        <span className="rounded bg-muted px-1.5 text-xs text-secondary">Ship-to matches</span>
      )}
    </span>
  )
}

function FullSelect({ customers, value, onChoose }: Pick<CustomerChoicesProps, 'customers' | 'value' | 'onChoose'>) {
  return (
    <select
      id="review_customer_id"
      aria-label="Customer"
      value={value}
      onChange={(event) => onChoose(event.target.value)}
      className={FORM_INPUT_CLASS}
    >
      <option value="">Select a customer…</option>
      {customers.map((customer) => (
        <option key={customer.id} value={customer.id}>
          {customer.status === 'inactive' ? `${customer.company_name} (inactive)` : customer.company_name}
        </option>
      ))}
    </select>
  )
}

/**
 * The review pane's customer field (Task 118): the matcher's candidates as a
 * ranked one-tap list, labelled "Inactive" and "Ship-to matches", then
 * "Choose another customer…", which reveals the full select. With no
 * candidates the full select shows straight away.
 */
export default function CustomerChoices({ choices, customers, value, onChoose }: CustomerChoicesProps) {
  const isOffList = value !== '' && !choices.some((choice) => choice.customerId === value)
  const [showAll, setShowAll] = useState(choices.length === 0 || isOffList)

  return (
    <FieldRow label="Customer" htmlFor={showAll ? 'review_customer_id' : undefined}>
      {choices.length > 0 && (
        <div role="group" aria-label="Matched customers" className="space-y-2">
          {choices.map((choice) => (
            <button
              key={choice.customerId}
              type="button"
              aria-pressed={choice.customerId === value}
              onClick={() => onChoose(choice.customerId)}
              className={`block min-h-[44px] w-full rounded-md border px-3 py-2 text-left text-sm ${
                choice.customerId === value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card text-foreground'
              }`}
            >
              <span className="block font-medium">{choice.companyName}</span>
              <ChoiceLabels choice={choice} />
            </button>
          ))}
        </div>
      )}
      {showAll ? (
        <FullSelect customers={customers} value={value} onChoose={onChoose} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="min-h-[44px] text-sm text-primary underline underline-offset-2"
        >
          Choose another customer…
        </button>
      )}
    </FieldRow>
  )
}
