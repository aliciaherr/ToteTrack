'use client'

import type { InvoiceDetail, InvoiceLedgerRow } from '@/db/queries/invoices'
import InvoiceLedgerDetail from './InvoiceLedgerDetail'
import { LedgerTable } from './InvoiceLedgerParts'
import { formatCurrency } from '@/lib/format-currency'

interface InvoiceLedgerProps {
  invoices: InvoiceLedgerRow[]
  selectedInvoiceId: string | null
  detail: InvoiceDetail | null
  billingMonth: string
}

/**
 * Builds an `/invoices` href that preserves the generation-panel state
 * (`billingMonth`) and optionally selects an invoice id.
 */
export function buildLedgerHref(current: {
  billingMonth: string
  selectedInvoiceId: string | null
}): string {
  const params = new URLSearchParams()
  params.set('billingMonth', current.billingMonth)
  if (current.selectedInvoiceId) params.set('id', current.selectedInvoiceId)
  return `/invoices?${params.toString()}`
}

/**
 * Right-panel dispatcher for the Invoices screen. Renders either the ledger
 * list (chronological newest-first, no filters) or the invoice detail view
 * depending on whether `selectedInvoiceId` is set. v3: status filter pills
 * removed — invoices have no status anymore.
 */
export default function InvoiceLedger({
  invoices,
  selectedInvoiceId,
  detail,
  billingMonth,
}: InvoiceLedgerProps) {
  if (selectedInvoiceId) {
    const backHref = buildLedgerHref({ billingMonth, selectedInvoiceId: null })
    return <InvoiceLedgerDetail detail={detail} backHref={backHref} />
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Invoice Ledger</h2>
      {invoices.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No invoices generated yet.
        </p>
      ) : (
        <LedgerTable
          invoices={invoices}
          rowHrefFor={(invoiceId) =>
            buildLedgerHref({ billingMonth, selectedInvoiceId: invoiceId })
          }
          formatAmount={(raw) => formatCurrency(raw)}
        />
      )}
    </div>
  )
}
