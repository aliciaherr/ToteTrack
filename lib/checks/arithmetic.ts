import type { ExtractedLine, ExtractedPo } from '@/lib/extraction/types'
import { formatCurrency } from '@/lib/format-currency'
import { CENTS_PER_DOLLAR, MONEY_TOLERANCE_CENTS } from './checks.constants'
import type { CheckFailure } from './types'

/** Dollars to whole cents. Every comparison below is in cents. */
function toCents(dollars: number): number {
  return Math.round(dollars * CENTS_PER_DOLLAR)
}

function formatCents(cents: number): string {
  return formatCurrency(cents / CENTS_PER_DOLLAR)
}

function differ(a: number, b: number): boolean {
  return Math.abs(a - b) > MONEY_TOLERANCE_CENTS
}

/** A line's amount: qty × unit when both are stated, else its printed line total. */
function lineAmountCents(line: ExtractedLine): number | null {
  if (line.quantity !== null && line.unitPrice !== null) return toCents(line.quantity * line.unitPrice)
  return line.lineTotal === null ? null : toCents(line.lineTotal)
}

/**
 * Each line's own arithmetic: qty × unit must equal the printed line total,
 * and a line total with no unit price must split evenly across the quantity.
 */
function checkLines(lines: ExtractedLine[]): CheckFailure[] {
  const failures: CheckFailure[] = []
  lines.forEach((line, index) => {
    const field = `lines[${index}]`
    const { quantity, unitPrice, lineTotal } = line
    if (quantity === null || lineTotal === null) return
    if (unitPrice !== null && differ(toCents(quantity * unitPrice), toCents(lineTotal))) {
      failures.push({
        check: 'line_total_mismatch',
        field,
        detail: `${quantity} × $${unitPrice} = ${formatCents(toCents(quantity * unitPrice))}, but the line total is ${formatCents(toCents(lineTotal))}`,
      })
    }
    if (unitPrice === null && quantity > 0 && toCents(lineTotal) % quantity !== 0) {
      failures.push({
        check: 'line_total_indivisible',
        field,
        detail: `line total ${formatCents(toCents(lineTotal))} does not divide evenly by quantity ${quantity}`,
      })
    }
  })
  return failures
}

/**
 * The stated total against the tote lines. Any gap is a failure — the order
 * price comes from tote lines only. When `other` lines (fees, accruals,
 * freight) add up to the gap exactly, the detail names them so the reviewer
 * can clear it at a glance (builder decision 2026-10-12: flag, don't pass).
 */
function checkTotal(extracted: ExtractedPo): CheckFailure[] {
  const stated = extracted.statedTotal.value
  if (stated === null) return []
  const toteCents = extracted.lines.reduce(
    (sum, line) => sum + (line.kind === 'tote' ? (lineAmountCents(line) ?? 0) : 0),
    0,
  )
  const gap = toCents(stated) - toteCents
  if (!differ(gap, 0)) return []

  const others = extracted.lines.flatMap((line, index) => {
    const cents = lineAmountCents(line)
    return line.kind === 'other' && cents ? [{ index, cents }] : []
  })
  const otherCents = others.reduce((sum, { cents }) => sum + cents, 0)
  const covered =
    others.length > 0 && !differ(otherCents, gap)
      ? `; covered exactly by other lines: ${others.map(({ index, cents }) => `lines[${index}] ${formatCents(cents)}`).join(', ')}`
      : ''
  return [
    {
      check: 'total_mismatch',
      field: 'statedTotal',
      detail: `stated total ${formatCents(toCents(stated))} ≠ tote lines ${formatCents(toteCents)} (gap ${formatCents(gap)})${covered}`,
    },
  ]
}

/**
 * Arithmetic checks, to the cent (`MONEY_TOLERANCE_CENTS`).
 *
 * @param extracted - A validated extraction.
 * @returns One failure per broken line, plus one if the stated total and the
 *   tote lines disagree. Empty when everything adds up.
 */
export function checkArithmetic(extracted: ExtractedPo): CheckFailure[] {
  return [...checkLines(extracted.lines), ...checkTotal(extracted)]
}
