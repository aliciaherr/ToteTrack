'use client'

import type {
  VolumeBucket,
  VolumeOverview as VolumeOverviewData,
} from '@/db/queries/customers'

type BucketKey = Exclude<keyof VolumeBucket, 'totalAvg'>

const TYPE_ROWS: Array<{ label: string; key: BucketKey }> = [
  { label: 'Rebottled', key: 'rebottled' },
  { label: 'Reconditioned', key: 'reconditioned' },
  { label: 'Brand New', key: 'brandNew' },
]

function formatAvg(value: number): string {
  if (value <= 0) return '0 totes avg'
  const rounded = Math.round(value * 10) / 10
  const display = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)
  return `${display} totes avg`
}

function progressWidth(typeAvg: number, totalAvg: number): number {
  // Divide-by-zero guard (EH-01): no completed orders for this size → 0% bars.
  if (totalAvg <= 0) return 0
  const pct = (typeAvg / totalAvg) * 100
  return Math.max(0, Math.min(100, pct))
}

function BucketSection({ title, bucket }: { title: string; bucket: VolumeBucket }) {
  return (
    <div className="flex-1 bg-card rounded-xl border border-border p-4">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{title}</h4>
      <div className="space-y-3">
        {TYPE_ROWS.map(({ label, key }) => {
          const value = bucket[key]
          const pct = progressWidth(value, bucket.totalAvg)
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-foreground">{label}</span>
                <span className="text-xs text-secondary">{formatAvg(value)}</span>
              </div>
              <div
                role="progressbar"
                aria-label={`${title} ${label} ${formatAvg(value)}`}
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 bg-muted rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-in-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Per-PO volume profile shown on the customer detail panel. Renders two
 * side-by-side cards (275 Gallon, 330 Gallon), each with three progress bars
 * (Rebottled, Reconditioned, Brand New). The bar width represents each type's
 * share of `totalAvg` within the same size; a bucket with no completed orders
 * collapses to three empty bars labeled "0 totes avg" instead of NaN.
 */
export default function VolumeOverview({ data }: { data: VolumeOverviewData }) {
  return (
    <section aria-label="Volume overview per PO">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary mb-3">
        Volume Overview (Per PO)
      </h3>
      <div className="flex flex-col lg:flex-row gap-3">
        <BucketSection title="275 Gallon" bucket={data.gal275} />
        <BucketSection title="330 Gallon" bucket={data.gal330} />
      </div>
    </section>
  )
}
