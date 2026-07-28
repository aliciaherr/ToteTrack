'use client'

/**
 * Compact amber `SD` tag flagging a same-day delivery. Mirrors `BackhaulTag`'s
 * weight and height so the two sit level when a PO carries both; `rounded-md`
 * rather than `rounded-full` because two characters in a circle reads as a
 * squashed pill. Render conditionally at the call site.
 */
export default function SameDayTag() {
  return (
    <span
      aria-label="Same-day delivery"
      title="Same-day delivery"
      className="inline-flex items-center justify-center rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold px-1 h-5 leading-none select-none"
    >
      SD
    </span>
  )
}
