'use client'

import { Loader2, RotateCw } from 'lucide-react'
import { useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import OrderContainerFields from '@/components/orders/OrderContainerFields'
import OrderLogisticsFields from '@/components/orders/OrderLogisticsFields'
import { computeFormTotal } from '@/components/orders/orderFormSchema'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'
import CustomerChoices from './CustomerChoices'
import FieldStatusFrame from './FieldStatusFrame'
import { AddressGroup, OptionFieldGroup } from './ReviewFieldParts'
import ToCheckSection from './ToCheckSection'
import { fieldStatus, isGroupEdited, missingFieldLines, type FieldGroup } from './reviewPane.helpers'
import { useReviewForm } from './useReviewForm'
import type { FieldsState } from './useReviewQueue'

interface ReviewFieldsPaneProps {
  state: FieldsState
  onRetry: () => void
}

function LoadingView() {
  return (
    <p className="flex items-center gap-2 p-4 text-sm text-secondary">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Loading this PO&apos;s values…
    </p>
  )
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 p-4">
      <p className="text-sm text-destructive">Couldn&apos;t load this PO&apos;s values</p>
      <Button type="button" variant="outline" onClick={onRetry} className="min-h-[44px]">
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

/** The pre-filled order form under its "To check" section, each field group in its status frame. */
function ReadyFields({ fields, customers }: { fields: ReviewFields; customers: ReviewCustomer[] }) {
  const review = useReviewForm(fields, customers)
  const { form } = review
  const { register, watch, setValue, formState } = form
  const values = useWatch({ control: form.control }) as typeof fields.values
  const statusOf = (group: FieldGroup) =>
    fieldStatus(group, values, fields.flags, isGroupEdited(group, values, fields.values))

  return (
    <div className="space-y-4 p-4">
      <ToCheckSection
        flags={fields.flags}
        missingLines={missingFieldLines(fields.values, fields.flags)}
        totals={fields.totals}
        liveTotal={computeFormTotal(values)}
      />
      <FieldStatusFrame status={statusOf('po_number')}>
        <OptionFieldGroup form={form} field="po_number" label="PO Number" type="text" options={fields.poNumberOptions} onChoose={review.chooseOption} />
      </FieldStatusFrame>
      <FieldStatusFrame status={statusOf('customer_id')}>
        <CustomerChoices choices={fields.customerChoices} customers={customers} value={watch('customer_id')} onChoose={review.chooseCustomer} />
      </FieldStatusFrame>
      {!values.customer_collects && (
        <FieldStatusFrame status={statusOf('delivery_address')}>
          <AddressGroup
            form={form}
            addresses={review.addresses}
            offersSavedAddress={fields.flags.some((flag) => flag.kind === 'missing_ship_to')}
            onFill={review.fillSavedAddress}
          />
        </FieldStatusFrame>
      )}
      <FieldStatusFrame status={statusOf('quantities')}>
        <OrderContainerFields register={register} watch={watch} setValue={setValue} errors={formState.errors} qtyError={null} />
      </FieldStatusFrame>
      <FieldStatusFrame status={statusOf('requested_delivery_date')}>
        <OptionFieldGroup
          form={form}
          field="requested_delivery_date"
          label="Requested Delivery Date"
          type="date"
          options={fields.deliveryDateOptions}
          onChoose={review.chooseOption}
        />
      </FieldStatusFrame>
      <OrderLogisticsFields register={register} />
    </div>
  )
}

/**
 * The review overlay's right pane (Tasks 118, 119): one PO's order form,
 * pre-filled from its extraction by `getReviewFields`, reusing the order
 * form's own parts. Every issue is listed once, at the top; each field group
 * is green when read with confidence, red when empty or flagged. No Approve,
 * Skip or Delete yet (Task 108); edits are lost on close. Loads beside the
 * source with its own loading and error state, never blank (EH-01).
 */
export default function ReviewFieldsPane({ state, onRetry }: ReviewFieldsPaneProps) {
  if (state.status === 'loading') return <LoadingView />
  if (state.status === 'error') return <ErrorView onRetry={onRetry} />
  return <ReadyFields fields={state.fields} customers={state.customers} />
}
