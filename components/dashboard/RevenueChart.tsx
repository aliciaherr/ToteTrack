'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  transformForMode,
  type ChartMode,
  type ChartPoint,
} from '@/lib/invoice-chart-transforms'
import { formatCurrency } from '@/lib/format-currency'
import type { RevenueTrendRow } from '@/db/queries/dashboard'

interface RevenueChartProps {
  data: RevenueTrendRow[]
}

type TimeScale = 'monthly' | 'annual'
type TotalShape = 'per_period' | 'cumulative'

const CHART_ANIMATION_DURATION_MS = 300
const CHART_HEIGHT_PX = 300
const CHART_BAR_FILL = '#007A8A'

function modeFor(time: TimeScale, total: TotalShape): ChartMode {
  if (time === 'monthly' && total === 'per_period') return 'per_period_monthly'
  if (time === 'monthly' && total === 'cumulative') return 'cumulative_monthly'
  if (time === 'annual' && total === 'per_period') return 'per_period_annual'
  return 'cumulative_annual'
}

function TooltipBody({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: ChartPoint }> }) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]!.payload
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-foreground">{point.label}</div>
      <div className="text-muted-foreground tabular-nums">
        {formatCurrency(point.value)}
      </div>
    </div>
  )
}

function PillToggle<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={`min-h-[44px] px-4 text-sm font-medium rounded-full transition-colors ${
              isActive ? 'bg-primary text-primary-foreground' : 'text-secondary hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ChartEmptyState() {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ height: CHART_HEIGHT_PX }}
    >
      No revenue data yet.
    </div>
  )
}

function ChartBody({ points, animationDuration }: { points: ChartPoint[]; animationDuration: number }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT_PX}>
      <BarChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
        <CartesianGrid vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748B" />
        <YAxis tick={{ fontSize: 12 }} stroke="#64748B" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<TooltipBody />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
        <Bar dataKey="value" fill={CHART_BAR_FILL} radius={[4, 4, 0, 0]} animationDuration={animationDuration} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Dashboard revenue trend chart — booked revenue (summed order prices for
 * non-cancelled orders) per month. Two orthogonal pill toggles drive the
 * 4-mode selector: Monthly/Annual (time scale) × Per Period/Cumulative
 * (total shape). The transform layer (`lib/invoice-chart-transforms.ts`)
 * reshapes raw monthly rollups into the active mode's series.
 * Bar animation runs at 300ms on mode switch; `useReducedMotion()` drops
 * it to 0. Renders a centred empty state when `data` is empty.
 */
export default function RevenueChart({ data }: RevenueChartProps) {
  const shouldReduceMotion = useReducedMotion()
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [timeScale, setTimeScale] = useState<TimeScale>('monthly')
  const [totalShape, setTotalShape] = useState<TotalShape>('per_period')
  const today = useMemo(() => new Date(), [])
  const points = useMemo(
    () => transformForMode(modeFor(timeScale, totalShape), data, today),
    [data, timeScale, totalShape, today],
  )
  const animationDuration = shouldReduceMotion ? 0 : CHART_ANIMATION_DURATION_MS
  const collapseTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: 'easeInOut' as const }
  return (
    <section aria-label="Revenue trend" className="rounded-xl bg-card border border-border">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-expanded={!isCollapsed}
          aria-controls="revenue-chart-body"
          className="flex items-center gap-2 min-h-[44px] -mx-2 px-2 rounded-lg hover:bg-muted transition-colors"
        >
          <h2 className="text-sm font-semibold text-foreground">Revenue Trend</h2>
          <motion.span
            animate={{ rotate: isCollapsed ? 0 : 180 }}
            transition={collapseTransition}
            className="inline-flex"
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </motion.span>
        </button>
        {!isCollapsed && data.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <PillToggle<TimeScale>
              ariaLabel="Time scale"
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Annual' },
              ]}
              value={timeScale}
              onChange={setTimeScale}
            />
            <PillToggle<TotalShape>
              ariaLabel="Total shape"
              options={[
                { value: 'per_period', label: 'Per Period' },
                { value: 'cumulative', label: 'Cumulative' },
              ]}
              value={totalShape}
              onChange={setTotalShape}
            />
          </div>
        )}
      </header>
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="chart-body"
            id="revenue-chart-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={collapseTransition}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-4">
              {data.length === 0 ? (
                <ChartEmptyState />
              ) : (
                <ChartBody points={points} animationDuration={animationDuration} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
