/**
 * Generic parser for the `?new=1` URL deep-link convention used by the list
 * routes (orders, customers, leads). Each list layout takes an `initialMode`
 * prop whose `'detail'` value means "show the empty state / selected detail"
 * and whose `'new-X'` value means "open the New X form on mount". This helper
 * normalizes the URL string into the right literal type.
 *
 * @param value - Raw `searchParams.new` value (string or undefined).
 * @param openMode - The literal "new" mode for this route (e.g. `'new-customer'`).
 * @returns `openMode` when `value === '1'`, otherwise `'detail'`.
 */
export function parseInitialMode<TOpen extends string>(
  value: string | undefined,
  openMode: TOpen,
): TOpen | 'detail' {
  return value === '1' ? openMode : 'detail'
}
