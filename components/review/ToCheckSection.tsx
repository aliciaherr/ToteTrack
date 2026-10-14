'use client'

import { AlertTriangle, HelpCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/format-currency'
import type { FieldFlag, ReviewTotals } from '@/lib/review/review-fields.types'
import { isFailureFlag, orderFlags } from './reviewPane.helpers'

interface ToCheckSectionProps {
  flags: FieldFlag[]
  /** Lines for required fields the reading left empty, from `missingFieldLines`. */
  missingLines: string[]
  totals: ReviewTotals
  /** The form's live Σ(qty × unit price), as the order form computes it. */
  liveTotal: string
  /** The selected customer's name when it is inactive, else null (Task 120). */
  inactiveCustomer?: string | null
}

function Line({ isFailure, children }: { isFailure: boolean; children: React.ReactNode }) {
  const Icon = isFailure ? AlertTriangle : HelpCircle
  return (
    <li className={`flex gap-2 text-sm ${isFailure ? 'text-destructive' : 'text-foreground'}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  )
}

/** The arithmetic behind a total mismatch: both totals, then the PO's other money lines. */
function MismatchDetail({ totals, liveTotal }: Pick<ToCheckSectionProps, 'totals' | 'liveTotal'>) {
  return (
    <ul aria-label="Totals" className="mt-1 space-y-0.5 text-xs text-foreground">
      <li className="flex justify-between gap-3">
        <span>Document total</span>
        <span className="tabular-nums">{totals.stated === null ? 'Not stated' : formatCurrency(totals.stated)}</span>
      </li>
      <li className="flex justify-between gap-3">
        <span>Qty × price</span>
        <span className="tabular-nums">{formatCurrency(liveTotal)}</span>
      </li>
      {totals.otherLines.map((line, index) => (
        <li key={index} className="flex justify-between gap-3 text-secondary">
          <span className="break-words">{line.quote}</span>
          <span className="shrink-0 tabular-nums">{line.amount === null ? 'no amount' : formatCurrency(line.amount)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The top of the review pane (Task 119): every issue on the PO in one list,
 * failed checks first, then the required fields the reading left empty. A
 * total mismatch carries its arithmetic. The form below carries no text of
 * its own. An inactive selected customer is listed last: approving
 * reactivates it (Task 120). Flag messages are our wording; money-line text
 * and customer names are rendered as text (L-D).
 */
export default function ToCheckSection({ flags, missingLines, totals, liveTotal, inactiveCustomer = null }: ToCheckSectionProps) {
  const count = flags.length + missingLines.length + (inactiveCustomer ? 1 : 0)
  return (
    <section aria-labelledby="review-to-check" className="rounded-md border border-border bg-card p-3">
      <h3 id="review-to-check" className="mb-2 text-sm font-semibold text-foreground">
        {count === 0 ? 'Nothing to check' : `To check (${count})`}
      </h3>
      {count === 0 ? (
        <p className="text-sm text-secondary">Every field was read with confidence.</p>
      ) : (
        <ul className="space-y-2">
          {orderFlags(flags).map((flag) => (
            <Line key={`${flag.field}|${flag.kind}`} isFailure={isFailureFlag(flag)}>
              {flag.message}
              {flag.kind === 'total_mismatch' && <MismatchDetail totals={totals} liveTotal={liveTotal} />}
            </Line>
          ))}
          {missingLines.map((line) => (
            <Line key={line} isFailure={false}>
              {line}
            </Line>
          ))}
          {inactiveCustomer && <Line isFailure={false}>{`${inactiveCustomer} is inactive: approving reactivates it`}</Line>}
        </ul>
      )}
    </section>
  )
}
