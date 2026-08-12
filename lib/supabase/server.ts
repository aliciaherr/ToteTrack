import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server Supabase client — reads the user's session from cookies.
 * Call from Server Components, Server Actions, and Route Handlers only.
 * SUPABASE_SERVICE_ROLE_KEY lives in this file only — never in client.ts or any client component.
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
