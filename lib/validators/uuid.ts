/**
 * Shared UUID validator. Version-agnostic: matches any RFC 4122 8-4-4-4-12
 * hex layout regardless of variant/version bits. Used to validate any id-
 * shaped string that crosses a system boundary before it reaches a DB query.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns true when `value` is a UUID-shaped string. Narrows the type so the
 * caller can use `value` as `string` inside the truthy branch.
 */
export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
