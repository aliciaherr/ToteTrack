'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type { AuthError } from '@supabase/supabase-js'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

const PASSWORD_MAX_LENGTH = 72 // bcrypt effective maximum

const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH)

/**
 * Signs in using the admin password. Email is always read from ADMIN_EMAIL env var — never from the client.
 * @param password - Password entered by the user. Validated against PASSWORD_MAX_LENGTH before use.
 * @returns `{ error: null }` on success (followed by redirect to /dashboard). `{ error: string }` on failure — user-facing message.
 */
export async function signIn(password: string): Promise<{ error: string | null }> {
  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) {
    return { error: 'Incorrect password. Please try again.' }
  }

  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error('signIn: ADMIN_EMAIL env var is not set')
    return { error: 'Unable to connect. Check your internet connection.' }
  }

  let authError: AuthError | null = null

  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail, password: parsed.data })
    authError = error
  } catch (cause) {
    console.error('signIn: network error', { cause })
    return { error: 'Unable to connect. Check your internet connection.' }
  }

  if (!authError) {
    redirect('/dashboard')
    return { error: null } // unreachable in production; returned in tests when redirect is mocked
  }

  if (authError.status === 400) {
    return { error: 'Incorrect password. Please try again.' }
  }

  console.error('signIn: unexpected auth error', { message: authError.message, status: authError.status })
  return { error: 'Unable to connect. Check your internet connection.' }
}

/**
 * Signs out the current session and redirects to /login.
 *
 * Two failure surfaces, both logged with context and returned as `{ error }`
 * (audit L-02 — a failed sign-out must reach the user, never silently
 * redirect):
 * - supabase-js v2 `auth.signOut()` RESOLVES with `{ error }` on an
 *   auth-service failure rather than throwing — the resolved error is
 *   captured and checked before redirecting.
 * - A thrown/rejected call (network failure, service down) is caught so it
 *   never escapes as an unhandled rejection.
 * The `redirect()` stays outside the `try` so its `NEXT_REDIRECT` throw is
 * not swallowed by the catch, and only runs when there was no error.
 * @returns Nothing on success (followed by redirect to /login). `{ error: string }` on an auth-service failure — user-facing message.
 */
export async function signOut(): Promise<{ error: string } | void> {
  let signOutError: AuthError | null = null
  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    signOutError = error
  } catch (cause) {
    console.error('signOut: auth service failure', { operation: 'supabase.auth.signOut', cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
  if (signOutError) {
    console.error('signOut: auth service failure', {
      operation: 'supabase.auth.signOut',
      cause: signOutError,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
  redirect('/login')
}
