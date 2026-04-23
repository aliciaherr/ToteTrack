/**
 * Shared Tailwind class maps and display labels for the support screen's
 * priority, status, and category badges. Used by both `TicketList` (row
 * badges) and `TicketDetail` (metadata section) so the palette and
 * spelling cannot drift between the two views.
 */
import type {
  SupportCategory,
  SupportPriority,
  TicketStatus,
} from '@/db/queries/support'

const PRIORITY_CLASSES: Record<SupportPriority, string> = {
  critical: 'bg-red-100 text-red-800 border border-red-200',
  high: 'bg-orange-100 text-orange-800 border border-orange-200',
  standard: 'bg-slate-100 text-slate-700 border border-slate-200',
  low: 'bg-slate-50 text-slate-600 border border-slate-200',
}

const STATUS_CLASSES: Record<TicketStatus, string> = {
  open: 'bg-blue-100 text-blue-800 border border-blue-200',
  in_progress: 'bg-amber-100 text-amber-800 border border-amber-200',
  resolved: 'bg-green-100 text-green-800 border border-green-200',
  closed: 'bg-gray-100 text-gray-700 border border-gray-200',
}

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: 'Bug',
  feature_request: 'Feature Request',
  question: 'Question',
  other: 'Other',
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

const PRIORITY_LABELS: Record<SupportPriority, string> = {
  critical: 'Critical',
  high: 'High',
  standard: 'Standard',
  low: 'Low',
}

export function priorityBadgeClasses(priority: SupportPriority): string {
  return PRIORITY_CLASSES[priority]
}

export function statusBadgeClasses(status: TicketStatus): string {
  return STATUS_CLASSES[status]
}

export function categoryLabel(category: SupportCategory): string {
  return CATEGORY_LABELS[category]
}

export function statusLabel(status: TicketStatus): string {
  return STATUS_LABELS[status]
}

export function priorityLabel(priority: SupportPriority): string {
  return PRIORITY_LABELS[priority]
}
