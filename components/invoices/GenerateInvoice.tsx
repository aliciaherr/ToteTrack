'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format, parse, isValid } from 'date-fns'
import type { InvoiceableOrder } from '@/db/queries/invoices'
import {
  DraftTotalsBar,
  InvoiceFilters,
  OrdersChecklist,
} from './GenerateInvoiceParts'
import OverwriteInvoiceDialog from './OverwriteInvoiceDialog'
import { useInvoiceSubmit } from './useInvoiceSubmit'

interface GenerateInvoiceProps {
  orders: InvoiceableOrder[]
  billingMonth: string
}

function buildHref(billingMonth: string): string {
  const params = new URLSearchParams()
  params.set('billingMonth', billingMonth)
  return `/invoices?${params.toString()}`
}

function billingMonthLabel(billingMonth: string): string {
  const parsed = parse(billingMonth, 'yyyy-MM', new Date())
  return isValid(parsed) ? format(parsed, 'MMMM yyyy') : billingMonth
}

/**
 * Left-panel Generate Invoice workflow. v3: one invoice per (calendar)
 * month covers every customer's eligible POs. The salesperson picks the
 * billing month; the server component fetches all completed, uninvoiced
 * orders for that month (across customers); checkboxes default to all
 * checked but allow per-PO exclusion (e.g. disputed PO).
 *
 * If an invoice already exists for the chosen month, "Create Invoice"
 * surfaces an OverwriteInvoiceDialog instead of erroring. Confirming
 * deletes the existing invoice and creates a new one with the current
 * selection.
 */
export default function GenerateInvoice({ orders, billingMonth }: GenerateInvoiceProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(orders.map((order) => order.id)),
  )
  const {
    isSubmitting,
    error: submitError,
    overwritePrompt,
    submit,
    confirmOverwrite,
    cancelOverwrite,
  } = useInvoiceSubmit({
    clearSignal: orders,
    onSuccess: () => router.refresh(),
  })

  useEffect(() => {
    setCheckedIds(new Set(orders.map((order) => order.id)))
  }, [orders])

  const toggle = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const navigate = useCallback(
    (nextBillingMonth: string) => {
      startTransition(() => router.push(buildHref(nextBillingMonth)))
    },
    [router],
  )

  const draftTotal = useMemo(
    () => orders.reduce(
      (sum, order) => (checkedIds.has(order.id) ? sum + Number(order.price) : sum),
      0,
    ),
    [orders, checkedIds],
  )

  const hasOrders = orders.length > 0

  return (
    <div className={`pl-20 pr-6 py-6 space-y-4 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      <h2 className="text-lg font-semibold text-foreground">Generate Invoice</h2>
      <InvoiceFilters
        billingMonth={billingMonth}
        onBillingMonthChange={(value) => navigate(value)}
      />
      {submitError && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {submitError}
        </div>
      )}
      {hasOrders ? (
        <OrdersChecklist orders={orders} checkedIds={checkedIds} onToggle={toggle} />
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No completed orders for this period.
        </p>
      )}
      {hasOrders && (
        <DraftTotalsBar
          total={draftTotal}
          selectedCount={checkedIds.size}
          isSubmitting={isSubmitting}
          onCreate={() => submit({ billingMonth, orderIds: [...checkedIds] })}
        />
      )}
      <OverwriteInvoiceDialog
        open={overwritePrompt !== null}
        existingInvoiceNumber={overwritePrompt?.existingInvoiceNumber ?? ''}
        billingMonthLabel={billingMonthLabel(billingMonth)}
        isSubmitting={isSubmitting}
        onCancel={cancelOverwrite}
        onConfirm={confirmOverwrite}
      />
    </div>
  )
}
