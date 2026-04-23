/**
 * Customer-domain constants shared between server actions and client
 * components. Lives outside `customers.ts` (a `'use server'` file) because
 * Next.js only permits async function exports from server-action modules —
 * a plain `const` export there fails the compile step.
 */

export const MAX_CONTACTS_PER_CUSTOMER = 5
