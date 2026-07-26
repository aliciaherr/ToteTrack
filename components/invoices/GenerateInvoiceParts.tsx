'use client'

import { Button } from '@/components/ui/button'
import { sumPoSize, formatPoTotal } from '@/components/shared/qtyGridValues'
import type { InvoiceableOrder } from '@/db/queries/invoices'
import { formatCurrency } from '@/lib/format-currency'

function formatPoSizeSummary(order: InvoiceableOrder): string {
  const total275 = formatPoTotal(sumPoSize(order, '275'))
  const total330 = formatPoTotal(sumPoSize(order, '330'))
  return `275: ${total275} · 330: ${total330}`
}

interface InvoiceFiltersProps {
  billingMonth: string
  onBillingMonthChange: (value: string) => void
}

/**
 * Billing month picker. v3: customer dropdown removed — one invoice per
 * month covers every customer (CONSTRAINT-17).
 */
export function InvoiceFilters({
  billingMonth,
  onBillingMonthChange,
}: InvoiceFiltersProps) {
  return (
    <label className="flex flex-col gap-1 text-sm max-w-xs">
      <span className="font-medium text-foreground">Billing Month</span>
      <input
        type="month"
        value={billingMonth}
        aria-label="Billing month"
        onChange={(event) => onBillingMonthChange(event.target.value)}
        className="h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}

interface OrdersChecklistProps {
  orders: InvoiceableOrder[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
}

/**
 * Pre-checked checklist of invoiceable orders. Each row carries its own
 * toggle handler so the parent owns the (Set-based) selection state.
 */
export function OrdersChecklist({ orders, checkedIds, onToggle }: OrdersChecklistProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 px-4 py-2 bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="sr-only">Select</span>
        <span>PO #</span>
        <span>Customer</span>
        <span className="text-right">Price</span>
      </div>
      <ul role="list" className="divide-y divide-border">
        {orders.map((order) => (
          <li
            key={order.id}
            className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm"
          >
            <input
              type="checkbox"
              checked={checkedIds.has(order.id)}
              aria-label={`Include ${order.po_number}`}
              onChange={() => onToggle(order.id)}
              className="h-5 w-5 accent-primary cursor-pointer"
            />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{order.po_number}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{formatPoSizeSummary(order)}</p>
            </div>
            <div className="min-w-0 truncate text-foreground">
              {order.customer_name ?? '—'}
            </div>
            <div className="text-right font-medium text-foreground">
              {formatCurrency(order.price)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface DraftTotalsBarProps {
  total: number
  selectedCount: number
  isSubmitting: boolean
  onCreate: () => void
}

/**
 * Bottom bar of the Generate Invoice panel: current draft total plus the
 * "Create Invoice" action. Disabled when zero rows are checked or while a
 * submission is in flight.
 */
export function DraftTotalsBar({ total, selectedCount, isSubmitting, onCreate }: DraftTotalsBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Draft Total</span>
        <span
          aria-label="Draft total"
          aria-live="polite"
          className="text-2xl font-semibold text-foreground"
        >
          {formatCurrency(total)}
        </span>
      </div>
      <Button
        type="button"
        onClick={onCreate}
        disabled={selectedCount === 0 || isSubmitting}
        className="min-h-[44px] px-5"
      >
        {isSubmitting ? 'Creating…' : 'Create Invoice'}
      </Button>
    </div>
  )
}
