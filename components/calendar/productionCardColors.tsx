'use client'

import { Fragment } from 'react'
import type { SizeKey, TypeKey } from '@/components/shared/qtyGridValues'
import type { ProductionCombo } from './productionCardFormat'

// The card's combo-coloring concern, split out of `ProductionCard.tsx` to keep
// that file within the 200-line component cap (CQ-02). Lives beside
// `productionCardStatus.ts` / `productionCardFormat.ts`; kept apart from the
// format module so that one stays a pure-text `.ts` for text-only surfaces.

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
export function ColoredMix({ combos }: { combos: ProductionCombo[] }) {
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
