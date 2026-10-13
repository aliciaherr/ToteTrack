/**
 * Reading a required environment variable, the one way every server module
 * does it: trimmed, and a missing or blank value fails loudly, naming the
 * variable and never echoing a value (SEC-01).
 */

/**
 * Just the string lookups a reader needs. `process.env` satisfies it, and so
 * does a plain object literal in a test.
 */
export type EnvLookup = Readonly<Record<string, string | undefined>>

/** What every missing-variable error says after the variable's name. */
export const MISSING_ENV_DETAIL =
  'is missing or empty. Set it in .env and in the Vercel environment; .env.example lists the expected shape.'

/**
 * The trimmed value of `name`.
 *
 * @param env Where to read from; `process.env` in production.
 * @param name The variable.
 * @param makeError Builds the caller's own error type from the variable name
 *   and `MISSING_ENV_DETAIL`, so each subsystem keeps its error class (EH-05).
 * @returns The value, never blank.
 * @throws Whatever `makeError` returns, when the variable is unset or blank.
 */
export function requireEnv(
  env: EnvLookup,
  name: string,
  makeError: (variable: string, detail: string) => Error,
): string {
  const value = env[name]?.trim()
  if (!value) throw makeError(name, MISSING_ENV_DETAIL)
  return value
}
