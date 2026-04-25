'use client'

/**
 * Compact teal `B` tag that flags a backhaul PO. Used across every PO list
 * surface (orders table, dashboard Open Orders widget, customer Order
 * History rows, invoice detail PO rows) so the visual is consistent.
 * Render conditionally at the call site — the component itself has no
 * `backhaul` prop and no conditional rendering.
 */
export default function BackhaulTag() {
  return (
    <span
      aria-label="Backhaul"
      title="Backhaul"
      className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold w-5 h-5 leading-none select-none"
    >
      B
    </span>
  )
}
