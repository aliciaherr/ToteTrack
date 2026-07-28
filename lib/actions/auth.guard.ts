import { createClient } from '@/lib/supabase/server'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

// Re-exported so server actions keep one import site for the guard and its
// fallback copy. The constant itself lives in `lib/errors.ts`, which client
// components can also import — this module cannot cross that boundary because
// it pulls in the server-only Supabase client.
export { GENERIC_FAILURE_MESSAGE }

/**
 * Rejects the request unless a Supabase session is present. Returns null when
 * the caller may proceed.
 *
 * **Call this inside the action's `try` block.** `createClient()` and
 * `getUser()` both reach Supabase and can throw on a network or service
 * failure; called outside a `try`, that throw escapes the action instead of
 * becoming an `{ error }` result, and rejects on the client where nothing is
 * expecting it.
 *
 * A genuine auth-service failure is distinguished from a missing session: the
 * first is logged with its cause and reported as a connection problem, because
 * telling someone to sign in when they already are — and the service is simply
 * down — sends them to a login screen that cannot help them (EH-02, EH-04).
 */
export async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    console.error('assertAuthenticated: auth check failed', {
      operation: 'assertAuthenticated',
      status: error.status,
      cause: error,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }

  if (!data.user) return { error: 'You are not signed in.' }
  return null
}
