'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

import { z } from 'zod'
import type { AuthError } from '@supabase/supabase-js'

const PASSWORD_MAX_LENGTH = 72 // bcrypt effective maximum

// Supabase returns HTTP 400 specifically for invalid credentials. Any other
// status is an infrastructure problem, not a wrong password, and must not be
// reported to the user as one.
const INVALID_CREDENTIALS_STATUS = 400

const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH)

/**
 * Signs in using the admin password. Email is always read from ADMIN_EMAIL env var — never from the client.
 *
 * Deliberately does **not** `redirect()`. This action is awaited directly from
 * an event handler in `LoginForm`, not from a `<form action>` or a transition —
 * and `redirect()` works by throwing, so the throw would reject the awaited
 * promise, skip the caller's error handling, and leave the button stuck on
 * "Signing in…" with no navigation. The caller navigates on success instead,
 * which is the same pattern every other action in this codebase uses.
 *
 * `signOut` still redirects, correctly: it is invoked via `<form action>`.
 *
 * @param password - Password entered by the user. Validated against PASSWORD_MAX_LENGTH before use.
 * @returns `{ error: null }` on success — the caller routes to /dashboard. `{ error: string }` on failure — user-facing message.
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
    return { error: null }
  }

  if (authError.status === INVALID_CREDENTIALS_STATUS) {
    return { error: 'Incorrect password. Please try again.' }
  }

  // Log the error object itself, not just its message — EH-03 requires the stack.
  console.error('signIn: unexpected auth error', { status: authError.status, cause: authError })
  return { error: 'Unable to connect. Check your internet connection.' }
}

/** Signs out the current session and redirects to /login. */
export async function signOut(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
