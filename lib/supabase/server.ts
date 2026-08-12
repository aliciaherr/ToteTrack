import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server Supabase client — reads the user's session from cookies.
 * Call from Server Components, Server Actions, and Route Handlers only.
 * Uses the `anon` key, same as the browser client: RLS plus the session cookie
 * are the access control. This file holds no privileged credential — the
 * `service_role` key was never read here and was removed on 2026-08-12.
 *
 * Async since Next 15: `cookies()` returns a promise there, so every caller
 * must `await createClient()`. The `try` still guards the same failure — a
 * call from outside a server context — it is now an async rejection rather
 * than a synchronous throw.
 */
export async function createClient() {
  let cookieStore: Awaited<ReturnType<typeof cookies>>

  try {
    cookieStore = await cookies()
  } catch (cause) {
    throw new Error(
      'createClient (server): called outside server context — cookies() unavailable. ' +
        'Only call this from Server Components, Server Actions, or Route Handlers.',
      { cause }
    )
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies — only Server Actions can.
            // Swallowing here is intentional; the auth refresh still works.
          }
        },
      },
    }
  )
}
