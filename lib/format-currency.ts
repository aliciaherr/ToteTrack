/**
 * App-wide currency formatter. Renders USD with no trailing zeros:
 *   55     → $55
 *   25.5   → $25.5
 *   25.55  → $25.55
 *   25.05  → $25.05
 *
 * Single source of truth for money strings — replaces the ad-hoc
 * `Intl.NumberFormat` fragments that were duplicated across hero cards,
 * tables, charts, and the invoice generator.
 */

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) return typeof value === 'string' ? value : '—'
  return FORMATTER.format(numeric)
}
