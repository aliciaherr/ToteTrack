// Volume Overview shape: per-PO average quantity per (size × type) combo,
// across the customer's completed/invoiced POs.
//
// Formula (CONSTRAINT — Q7-aligned, post-Feature-9 wide-row schema):
//   "avg per PO that included this combo"
//   = AVG(qty_<size>_<type>) FILTER (WHERE qty_<size>_<type> > 0
//                                    AND status IN ('completed', 'invoiced'))
//
// The denominator is "POs that have a non-zero quantity for this combo," not
// "all POs." Multiple combos per PO is expected — the same PO can contribute
// to multiple combo averages, which is correct: each combo's average reflects
// what a typical order of that combo looks like.

export interface VolumeBucket {
  rebottled: number
  reconditioned: number
  brandNew: number
  totalAvg: number
}

export interface VolumeOverview {
  gal275: VolumeBucket
  gal330: VolumeBucket
}

export interface VolumeAveragesRow {
  avg_275_recon: string | null
  avg_275_rebot: string | null
  avg_275_new: string | null
  avg_330_recon: string | null
  avg_330_rebot: string | null
  avg_330_new: string | null
}

/**
 * All-zero volume overview. Used as a default value when no customer is
 * selected so the prop can stay non-nullable through the render tree.
 */
export const EMPTY_VOLUME_OVERVIEW: VolumeOverview = {
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}

// Coerces a possibly-null SQL numeric (returned as string from postgres-js) to
// a number; null and non-finite values fall back to 0 (a customer who has
// never ordered a given combo gets a 0 in that cell, not a hole).
function parseAvg(value: string | null): number {
  if (value === null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Folds the single-row 6-average aggregate into the grouped `VolumeOverview`
 * shape expected by the UI. `totalAvg` is the sum of the three type averages
 * within the same size so the UI can compute each bar's share without
 * recomputing.
 */
export function assembleVolumeOverview(row: VolumeAveragesRow | undefined): VolumeOverview {
  if (!row) return EMPTY_VOLUME_OVERVIEW
  const gal275: VolumeBucket = {
    reconditioned: parseAvg(row.avg_275_recon),
    rebottled: parseAvg(row.avg_275_rebot),
    brandNew: parseAvg(row.avg_275_new),
    totalAvg: 0,
  }
  const gal330: VolumeBucket = {
    reconditioned: parseAvg(row.avg_330_recon),
    rebottled: parseAvg(row.avg_330_rebot),
    brandNew: parseAvg(row.avg_330_new),
    totalAvg: 0,
  }
  gal275.totalAvg = gal275.rebottled + gal275.reconditioned + gal275.brandNew
  gal330.totalAvg = gal330.rebottled + gal330.reconditioned + gal330.brandNew
  return { gal275, gal330 }
}
