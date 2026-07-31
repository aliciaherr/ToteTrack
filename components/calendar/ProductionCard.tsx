'use client'

import { Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import BackhaulTag from '@/components/shared/BackhaulTag'
import SameDayTag from '@/components/shared/SameDayTag'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { SizeKey, TypeKey } from '@/components/shared/qtyGridValues'
import {
  ACTIVE_SURFACE_CLASS,
  BUILT_SURFACE_CLASS,
  isBuiltStatus,
} from './productionCardStatus'
import {
  formatProductionMix,
  productionMixText,
  type ProductionCombo,
} from './productionCardFormat'

/**
 * The calendar's tote color language: hue names the size (green 275 / blue
 * 330) and background depth names the type — REB plain text, REC a light
 * tint, NEW a medium tint. Two hues plus an intensity ladder stay tellable
 * apart at card font size where six distinct hues would not. Green deliberately
 * avoids the app's primary teal (#007A8A) so a combo never reads as a control.
 */
const COMBO_CLASS: Record<SizeKey, Record<TypeKey, string>> = {
  '275': {
    rebot: 'text-green-700',
    recon: 'text-green-700 bg-green-700/13 rounded-sm px-1',
    new: 'text-green-700 bg-green-700/32 rounded-sm px-1',
  },
  '330': {
    rebot: 'text-blue-700',
    recon: 'text-blue-700 bg-blue-700/13 rounded-sm px-1',
    new: 'text-blue-700 bg-blue-700/32 rounded-sm px-1',
  },
}

/** The mix line's combos, each colored by size/type; separators stay muted. */
function ColoredMix({ combos }: { combos: ProductionCombo[] }) {
  return (
    <>
      {combos.map((combo, index) => (
        <Fragment key={`${combo.sizeKey}-${combo.typeKey}`}>
          {index > 0 && ', '}
          <span className={`font-medium ${COMBO_CLASS[combo.sizeKey][combo.typeKey]}`}>
            {combo.label}
          </span>
        </Fragment>
      ))}
    </>
  )
}

interface ProductionCardProps {
  row: CalendarOrderRow
  /** True while `@dnd-kit` is carrying this card (Task 56). Lifts and fades it. */
  isDragging?: boolean
  /**
   * True while the card is armed by a touch long-press (Task 68). Bold primary
   * ring plus the shake from `globals.css` — the ring alone survives reduced
   * motion, so the armed state is never signalled by movement only.
   */
  isArmed?: boolean
}

function formatDeliveryDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  // `parseISO`, never `new Date(string)` — the latter reads a date-only string
  // as UTC midnight and prints the previous day in any negative-offset timezone.
  return format(parseISO(isoDate), 'MMM d')
}

/** PO number with the backhaul and same-day tags pushed to the right edge. */
function CardTitleRow({ row }: { row: CalendarOrderRow }) {
  return (
    <div className="flex items-center gap-1 min-w-0" style={{ height: 'var(--card-row-po)' }}>
      <span
        className="font-semibold text-foreground truncate flex-1 leading-none"
        style={{ fontSize: 'var(--card-fs-po)' }}
      >
        {row.po_number}
      </span>
      {row.backhaul && <BackhaulTag />}
      {row.same_day_delivery && <SameDayTag />}
    </div>
  )
}

interface TwoLineRowProps {
  children: React.ReactNode
  /** CSS custom-property names for this row's height, font size and line height. */
  metrics: { row: string; fontSize: string; lineHeight: string }
  className: string
  testId?: string
}

/**
 * A text row that occupies exactly two lines whether or not the text fills
 * them, truncating past the second. The fixed slot is what keeps every card the
 * same height regardless of content.
 */
function CardTwoLineRow({ children, metrics, className, testId }: TwoLineRowProps) {
  return (
    <p
      data-testid={testId}
      className={`line-clamp-2 overflow-hidden ${className}`}
      style={{
        height: `var(${metrics.row})`,
        fontSize: `var(${metrics.fontSize})`,
        lineHeight: `var(${metrics.lineHeight})`,
      }}
    >
      {children}
    </p>
  )
}

const NAME_ROW_METRICS = {
  row: '--card-row-name',
  fontSize: '--card-fs-name',
  lineHeight: '--card-line-name',
}

const MIX_ROW_METRICS = {
  row: '--card-row-mix',
  fontSize: '--card-fs-mix',
  lineHeight: '--card-line-mix',
}

/** Delivery promise, or an em dash — never the production date (CONSTRAINT-19). */
function CardDateRow({ isoDate }: { isoDate: string | null }) {
  return (
    <span
      className="text-muted-foreground tabular-nums leading-none mt-auto"
      style={{ height: 'var(--card-row-date)', fontSize: 'var(--card-fs-date)' }}
    >
      {formatDeliveryDate(isoDate)}
    </span>
  )
}

/**
 * A single PO on the production calendar.
 *
 * Every card is exactly `--card-h` tall regardless of content: the customer
 * name and the product mix each occupy a fixed 2-line slot and truncate past
 * it, so a 6-combo order for a long-named customer sits flush with a 1-combo
 * order for a short-named one. Ragged card heights would break the "4 whole
 * cards visible" target that the whole calendar layout is built around.
 *
 * Cards never show prices (CONSTRAINT-19) — the quantity mix is the whole
 * point at a glance, and money belongs in the popup.
 *
 * @param row Calendar row from `getCalendarOrders` / `getUnscheduledOrders`.
 * @param isDragging True while the card is being carried by a drag.
 * @param isArmed True while the card is armed by a touch long-press.
 */
export default function ProductionCard({
  row,
  isDragging = false,
  isArmed = false,
}: ProductionCardProps) {
  const mix = formatProductionMix(row)
  const isBuilt = isBuiltStatus(row.status)
  const isDraggable = !isBuilt

  return (
    <article
      data-testid="production-card"
      data-draggable={isDraggable ? 'true' : undefined}
      data-armed={isArmed ? 'true' : undefined}
      aria-label={`PO ${row.po_number}`}
      className={`flex flex-col rounded-md border border-border overflow-hidden select-none ${
        isBuilt ? BUILT_SURFACE_CLASS : `${ACTIVE_SURFACE_CLASS} cursor-grab`
      } ${isDragging ? 'opacity-80 shadow-lg' : ''} ${
        isArmed ? 'calendar-card-armed ring-2 ring-primary' : ''
      }`}
      style={{
        height: 'var(--card-h)',
        paddingBlock: 'var(--card-pad)',
        paddingInline: 'calc(var(--card-pad) * 2)',
      }}
    >
      <CardTitleRow row={row} />

      <CardTwoLineRow className="text-secondary" metrics={NAME_ROW_METRICS}>
        {row.customer_name ?? 'Unknown customer'}
      </CardTwoLineRow>

      <CardTwoLineRow
        testId="production-card-mix"
        className="text-muted-foreground tabular-nums"
        metrics={MIX_ROW_METRICS}
      >
        {mix.combos.length > 0 ? <ColoredMix combos={mix.combos} /> : productionMixText(mix)}
        {mix.hiddenCount > 0 && ` +${mix.hiddenCount} more`}
      </CardTwoLineRow>

      <CardDateRow isoDate={row.requested_delivery_date} />
    </article>
  )
}
