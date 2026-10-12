/**
 * A failure reduced to what may safely reach a log sink (SEC-05, MEDIUM-04).
 *
 * **Never log a database error whole.** Drizzle 0.45 wraps every driver error
 * in `DrizzleQueryError`, which carries the bound `params` and embeds them in
 * its message — and `console.error` prints the whole `cause` chain. For
 * ingestion those params are the sender address, subject and `Message-ID`, so
 * logging any error that has one anywhere in its chain leaks them.
 *
 * This keeps only values the code itself chose: class names, SQLSTATE,
 * constraint name and our own `DatabaseError.operation`. No message text is
 * kept from any layer — a driver message can quote the offending value. The
 * full error stays on whatever is thrown, for a debugger, not for the log.
 */

/** How many `cause` links to follow. Real chains are 2–3 deep; this only stops a cycle. */
const MAX_CAUSE_DEPTH = 5

export interface LoggableFailure {
  /** Class names from the outermost error inwards, e.g. `DatabaseError > DrizzleQueryError > Error`. */
  error: string
  /** The innermost SQLSTATE found, or `null`. */
  code: string | null
  /** The innermost constraint name found, or `null`. */
  constraint: string | null
  /** The `operation` of the outermost `DatabaseError`, or `null`. */
  operation: string | null
}

interface ErrorFields {
  cause?: unknown
  code?: unknown
  constraint_name?: unknown
  operation?: unknown
}

function className(layer: unknown): string {
  if (layer instanceof Error) return layer.constructor.name
  return layer === null ? 'null' : typeof layer
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** The cause chain, outermost first, bounded so a cyclic chain cannot hang. */
function causeChain(cause: unknown): unknown[] {
  const chain: unknown[] = []
  let layer = cause
  while (layer !== undefined && chain.length < MAX_CAUSE_DEPTH && !chain.includes(layer)) {
    chain.push(layer)
    layer = typeof layer === 'object' && layer !== null ? (layer as ErrorFields).cause : undefined
  }
  return chain
}

/**
 * Reduces `cause` to fields that are safe to log.
 *
 * @param cause Anything caught.
 * @returns Class names, SQLSTATE, constraint and operation — never a message,
 *   never params.
 */
export function loggableFailure(cause: unknown): LoggableFailure {
  const chain = causeChain(cause)
  const fields = chain.filter(
    (layer): layer is ErrorFields => typeof layer === 'object' && layer !== null,
  )
  const innermost = (read: (layer: ErrorFields) => unknown): string | null =>
    stringOrNull([...fields].reverse().map(read).find((value) => typeof value === 'string'))
  return {
    error: chain.map(className).join(' > '),
    code: innermost((layer) => layer.code),
    constraint: innermost((layer) => layer.constraint_name),
    operation: stringOrNull(fields.map((layer) => layer.operation).find((value) => typeof value === 'string')),
  }
}
