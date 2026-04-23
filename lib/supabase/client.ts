import { createBrowserClient } from '@supabase/ssr'

/** Browser Supabase client — safe for 'use client' components. Uses NEXT_PUBLIC_ vars only. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
