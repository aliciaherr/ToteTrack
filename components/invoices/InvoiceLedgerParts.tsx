'use client'

import Link from 'next/link'
import { parse, format, isValid } from 'date-fns'
import type { InvoiceLedgerRow, InvoicePoRow } from '@/db/queries/invoices'
import { formatQtySizeType } from './containerLabels'
import { formatCurrency } from '@/lib/format-currency'

/**
 * Formats a `YYYY-MM-DD` billing_month string into the "Month YYYY" display
 * form. Returns the raw string untouched if it cannot be parsed.
 */
export function formatBillingPeriod(billingMonth: string): string {
  const parsed = parse(billingMonth, 'yyyy-MM-dd', new Date())
  if (!isValid(parsed)) return billingMonth
  return format(parsed, 'MMMM yyyy')
}

interface LedgerTableProps {
  invoices: InvoiceLedgerRow[]
  rowHrefFor: (invoiceId: string) => string
  formatAmount: (rawAmount: string) => string
}

/**
 * Ledger list table — one row per invoice, click navigates to the detail
 * view. v3: status + customer columns dropped (invoices have no status,
 * and one invoice per month covers all customers).
 */
export function LedgerTable({ invoices, rowHrefFor, formatAmount }: LedgerTableProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-4 py-2 bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Invoice #</span>
        <span>Period</span>
        <span className="text-right">Amount</span>
      </div>
      <ul role="list" className="divide-y divide-border">
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link
              href={rowHrefFor(invoice.id)}
              aria-label={`Open invoice ${invoice.invoice_number}`}
              className="grid grid-cols-[1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm hover:bg-muted/50 min-h-[44px]"
            >
              <span className="font-medium text-foreground">{invoice.invoice_number}</span>
              <span className="text-muted-foreground">{formatBillingPeriod(invoice.billing_month)}</span>
              <span className="text-right font-medium text-foreground">{formatAmount(invoice.total_amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface InvoicePoRowsTableProps {
  rows: InvoicePoRow[]
}

/**
 * Read-only PO rows table used by the invoice detail view. v3: each row
 * also shows the customer name (joined from the order) since the invoice
 * itself no longer carries a customer reference.
 */
export function InvoicePoRowsTable({ rows }: InvoicePoRowsTableProps) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This invoice has no orders attached.
      </p>
    )
  }
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 px-4 py-2 bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>PO #</span>
        <span>Customer</span>
        <span>Details</span>
        <span className="text-right">Price</span>
      </div>
      <ul role="list" className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm"
          >
            <span className="font-medium text-foreground">{row.po_number}</span>
            <span className="truncate text-foreground">{row.customer_name ?? '—'}</span>
            <span className="text-muted-foreground">{formatQtySizeType(row)}</span>
            <span className="text-right font-medium text-foreground">
              {formatCurrency(row.price)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
