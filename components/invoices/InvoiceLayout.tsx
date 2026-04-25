'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import GenerateInvoice from './GenerateInvoice'
import InvoiceLedger from './InvoiceLedger'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type {
  InvoiceableOrder,
  InvoiceDetail,
  InvoiceLedgerRow,
} from '@/db/queries/invoices'

interface InvoiceLayoutProps {
  orders: InvoiceableOrder[]
  billingMonth: string
  invoices: InvoiceLedgerRow[]
  selectedInvoiceId: string | null
  detail: InvoiceDetail | null
}

/**
 * Two-panel shell for the Invoices screen. Left: GenerateInvoice (month
 * picker → orders checklist → draft total). Right: InvoiceLedger
 * (chronological list, or detail view when an invoice is selected).
 * Below lg, the ledger lives in a button-triggered slide-over.
 */
export default function InvoiceLayout({
  orders,
  billingMonth,
  invoices,
  selectedInvoiceId,
  detail,
}: InvoiceLayoutProps) {
  const [isLedgerOpen, setIsLedgerOpen] = useState(!!selectedInvoiceId)
  const openLedger = useCallback(() => setIsLedgerOpen(true), [])
  const closeLedger = useCallback(() => setIsLedgerOpen(false), [])

  return (
    <div className="h-[calc(100vh-0.75rem)] lg:grid lg:grid-cols-[minmax(360px,42%)_1fr]">
      <section
        aria-label="Generate invoice"
        className="bg-card border-r border-border overflow-y-auto"
      >
        <div className="lg:hidden pl-20 pr-4 pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={openLedger}
            className="w-full min-h-[44px]"
          >
            View Past Invoices
          </Button>
        </div>
        <GenerateInvoice orders={orders} billingMonth={billingMonth} />
      </section>
      <DetailDrawer
        isOpen={isLedgerOpen}
        onClose={closeLedger}
        ariaLabel="Invoice ledger"
      >
        <InvoiceLedger
          invoices={invoices}
          selectedInvoiceId={selectedInvoiceId}
          detail={detail}
          billingMonth={billingMonth}
        />
      </DetailDrawer>
    </div>
  )
}
