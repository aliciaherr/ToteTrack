import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/storage/po-document-url.constants'

/**
 * When a client re-signs a PO document link (Tasks 121 and the review source).
 * Shared by the order detail's link and the review overlay's source, and kept
 * free of runtime imports so either can use it without pulling a server action
 * into its tests or bundle.
 */

/**
 * Re-sign this long before the link expires: covers the sign round trip and
 * a slow network, so the link on screen never outlives its signature. Ages are
 * measured on the client clock alone, so client/server clock skew is irrelevant.
 */
export const RESIGN_SAFETY_MARGIN_MS = 5 * 60 * 1000

/** A link this old is re-signed: on its timer, or on the page becoming visible. */
export const RESIGN_AFTER_MS = SIGNED_URL_EXPIRY_SECONDS * 1000 - RESIGN_SAFETY_MARGIN_MS
