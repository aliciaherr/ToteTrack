/**
 * Support-domain constants shared between server actions and client
 * components. Lives outside `support.ts` (a `'use server'` file) because
 * Next.js only permits async function exports from server-action modules —
 * a plain `const` export there fails the production compile.
 */

export const SUPPORT_CATEGORIES = ['bug', 'feature_request', 'question', 'other'] as const
export const SUPPORT_PRIORITIES = ['low', 'standard', 'high', 'critical'] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]
