// These two are duplicated intentionally so the volume module doesn't create
// a circular import with customers.ts. They match the enum in db/schema/enums.ts.
type ContainerSize = '275' | '330'
type ContainerType = 'rebottled' | 'reconditioned' | 'brand_new'

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

export interface VolumeAggregateRow {
  container_size: ContainerSize
  container_type: ContainerType
  avg_quantity: string
}

/**
 * All-zero volume overview. Used as a default value when no customer is
 * selected so the prop can stay non-nullable through the render tree.
 */
export const EMPTY_VOLUME_OVERVIEW: VolumeOverview = {
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}

function emptyVolumeBucket(): VolumeBucket {
  return { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 }
}

function applyVolumeRow(bucket: VolumeBucket, type: ContainerType, avg: number): void {
  if (type === 'rebottled') bucket.rebottled = avg
  else if (type === 'reconditioned') bucket.reconditioned = avg
  else if (type === 'brand_new') bucket.brandNew = avg
}

/**
 * Folds the flat `(size, type, avg)` aggregate rows into the grouped
 * `VolumeOverview` shape expected by the UI. Missing combinations remain at
 * their default 0. `totalAvg` is the sum of the three type averages within
 * the same size so the UI can compute each bar's share without recomputing.
 */
export function assembleVolumeOverview(rows: VolumeAggregateRow[]): VolumeOverview {
  const overview: VolumeOverview = { gal275: emptyVolumeBucket(), gal330: emptyVolumeBucket() }
  for (const row of rows) {
    const bucket = row.container_size === '275' ? overview.gal275 : overview.gal330
    const avg = Number(row.avg_quantity)
    applyVolumeRow(bucket, row.container_type, Number.isFinite(avg) ? avg : 0)
  }
  overview.gal275.totalAvg =
    overview.gal275.rebottled + overview.gal275.reconditioned + overview.gal275.brandNew
  overview.gal330.totalAvg =
    overview.gal330.rebottled + overview.gal330.reconditioned + overview.gal330.brandNew
  return overview
}
