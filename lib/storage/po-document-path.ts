import { PO_DOCUMENT_PATH_PREFIX } from '@/lib/ingest/ingest.constants'

/**
 * The one shape of stored PO document key that may be signed (Task 121,
 * SEC-02). Ingestion writes every document as `inbound/<name>`; anything else
 * in `orders.document_url` (a legacy URL, a hand-typed value, a traversal
 * attempt) is never handed to Storage. Pure and not `'use server'`, so it is
 * not callable from the client (SEC-08).
 */

const INBOUND_FOLDER = `${PO_DOCUMENT_PATH_PREFIX}/`

/** `scheme:` at the start, e.g. `https:` or `data:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Control characters (including NUL) have no place in a storage key. */
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

/**
 * True when `value` is a key under the `inbound/` folder of the PO bucket:
 * starts with `inbound/`, names something after it, and has no `..` or `.`
 * segment, empty segment, backslash, scheme, leading slash or control character.
 *
 * @param value Whatever `orders.document_url` holds; non-strings are refused.
 */
export function isInboundDocumentPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value.startsWith(INBOUND_FOLDER) || value.length === INBOUND_FOLDER.length) return false
  if (value.includes('\\') || SCHEME_RE.test(value) || CONTROL_CHAR_RE.test(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
