/** Stands in for a credential anywhere a message could otherwise echo it. */
export const REDACTED = '[REDACTED]'

/**
 * Removes every occurrence of `secret` from text that is about to be thrown
 * or logged (SEC-01, SEC-05).
 *
 * @param text Text that may echo the secret, e.g. a library's error message.
 * @param secret The credential. A blank secret leaves the text unchanged.
 * @returns The text with the secret replaced by `REDACTED`.
 */
export function scrubSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join(REDACTED) : text
}
