import type { ContainerSize, ContainerType } from '@/db/queries/invoices'

/**
 * Display label for each fixed container size. Shared between the Generate
 * panel's checklist rows and the Ledger panel's PO detail rows so both
 * surfaces always speak the same language.
 */
export const CONTAINER_SIZE_LABEL: Record<ContainerSize, string> = {
  '275': '275 gal',
  '330': '330 gal',
}

/**
 * Display label for each container type enum value. Kept alongside
 * `CONTAINER_SIZE_LABEL` so any future additions to container types live in
 * a single module.
 */
export const CONTAINER_TYPE_LABEL: Record<ContainerType, string> = {
  rebottled: 'Rebottled',
  reconditioned: 'Reconditioned',
  brand_new: 'Brand New',
}

/**
 * Renders the "N × size · type" summary line used by both the Generate
 * panel's checklist rows and the Ledger detail's PO rows. Accepts a
 * structural shape so any entity carrying the three fields (invoiceable
 * orders, invoice PO rows, or a future entity) can use it without
 * widening the function signature.
 */
export function formatQtySizeType(item: {
  quantity: number
  container_size: ContainerSize
  container_type: ContainerType
}): string {
  return `${item.quantity} × ${CONTAINER_SIZE_LABEL[item.container_size]} · ${CONTAINER_TYPE_LABEL[item.container_type]}`
}
