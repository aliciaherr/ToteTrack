import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session on every request so it never expires mid-use.
  //
  // A failure here is logged and swallowed deliberately. This is a top-level
  // request boundary, and it is not the access control: `app/(app)/layout.tsx`
  // re-checks the user with its own `getUser()` and redirects to `/login` on
  // every authenticated render. Letting this throw would 500 every route the
  // matcher covers — including `/login` — so a Supabase blip would lock the
  // operator out of an app that is otherwise working. An unrefreshed session
  // still fails closed at the layout.
  try {
    await supabase.auth.getUser()
  } catch (cause) {
    console.error('proxy: session refresh failed — continuing unrefreshed', {
      pathname: request.nextUrl.pathname,
      cause,
    })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
}
