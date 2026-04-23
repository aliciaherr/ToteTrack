/**
 * Pure constants + types for the orders module — no DB imports, safe to
 * consume from client components. Lives outside `orders.ts` because that
 * module imports `@/db` (postgres-js driver), which is Node-only; any
 * client component that value-imports from there drags the entire driver
 * into the browser bundle and fails the production webpack build with
 * `Module not found: 'fs'` / `'perf_hooks'`.
 */

export const ORDERS_PAGE_SIZE = 20
