/**
 * Shared Tailwind class map for the Hot/Warm/Cold lead status badge. Used by
 * LeadList (row badge) and LeadDetail (engagement section badge). Single
 * source of truth so the palette cannot drift between the two screens.
 */
export const LEAD_STATUS_BADGE_CLASSES: Record<string, string> = {
  hot: 'bg-orange-100 text-orange-700',
  warm: 'bg-amber-100 text-amber-700',
  cold: 'bg-slate-100 text-slate-600',
}

/** Fallback classes used when the status value is unrecognised (defensive). */
export const LEAD_STATUS_BADGE_FALLBACK = 'bg-slate-100 text-slate-600'

export function leadStatusBadgeClasses(status: string): string {
  return LEAD_STATUS_BADGE_CLASSES[status] ?? LEAD_STATUS_BADGE_FALLBACK
}
