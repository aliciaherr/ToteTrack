/**
 * Lead-domain constants shared between server actions and client components.
 * Lives outside `leads.ts` (a `'use server'` file) because Next.js only
 * permits async function exports from server-action modules — a plain `const`
 * export there fails the production compile.
 */

// 2000 chars — ample for a single follow-up note while guarding textarea/DB bloat.
export const NOTE_CONTENT_MAX = 2000
