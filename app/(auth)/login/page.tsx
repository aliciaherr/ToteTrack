import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/auth/LoginForm'

// Reads session cookies to decide whether to redirect an already-logged-in
// user to /dashboard — must resolve per-request, not at build time.
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">ToteTrack</h1>
          <p className="text-sm text-muted-foreground mt-1">Sales operations</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-8">
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
