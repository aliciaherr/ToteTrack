'use client'

/**
 * Status-filter pill tabs for the Leads list header. Extracted from LeadList
 * to keep that file under the 200-line CQ-02 component cap — same pattern
 * as LeadFormFields / GenerateInvoiceParts. Uses `layoutId` so the active
 * pill background slides between tabs instead of cross-fading.
 */

import { motion, useReducedMotion } from 'framer-motion'
import type { LeadListStatus } from '@/db/queries/leads'

const STATUS_TABS: { value: LeadListStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
]

const LEAD_TAB_PILL_LAYOUT_ID = 'lead-status-tab-pill'

interface LeadStatusTabsProps {
  status: LeadListStatus
  onTabChange: (value: LeadListStatus) => void
}

export default function LeadStatusTabs({ status, onTabChange }: LeadStatusTabsProps) {
  const shouldReduceMotion = useReducedMotion()
  const pillTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: 'easeInOut' as const }

  return (
    <div role="tablist" aria-label="Filter leads by status" className="flex gap-1">
      {STATUS_TABS.map((tab) => {
        const isActive = status === tab.value
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.value)}
            className="relative flex-1 py-1.5 text-xs font-medium rounded-md min-h-[36px]"
          >
            {isActive && (
              <motion.span
                layoutId={LEAD_TAB_PILL_LAYOUT_ID}
                className="absolute inset-0 bg-primary rounded-md"
                transition={pillTransition}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                isActive
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
