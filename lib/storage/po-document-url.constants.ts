/**
 * Signed-link timing for PO documents (Tasks 106 and 121). No runtime
 * dependency, so the client hook that re-signs the link can import it without
 * pulling the server Supabase client (`next/headers`) into the browser bundle.
 */

/** How long a signed document URL works: 1 hour, as for support attachments. */
export const SIGNED_URL_EXPIRY_SECONDS = 60 * 60
