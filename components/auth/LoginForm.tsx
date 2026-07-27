'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from '@/lib/actions/auth'

/**
 * The sign-in form.
 *
 * Owns navigation itself rather than letting the server action redirect: this
 * awaits `signIn` from a plain event handler, and a server-action `redirect()`
 * works by throwing, so the throw would reject the awaited promise, skip the
 * error handling below, and leave the button spinning with nothing happening.
 * `signIn` therefore returns a result and this routes on success.
 */
export default function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value

    if (!password) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    setError(null)

    let result: { error: string | null }
    try {
      result = await signIn(password)
    } catch (cause) {
      // The action itself never throws for a bad password — reaching here means
      // the request failed outright (offline, action transport error). Surface
      // it rather than leaving the button spinning forever.
      console.error('LoginForm: sign-in request failed', { cause })
      setLoading(false)
      setError('Unable to connect. Check your internet connection.')
      return
    }

    if (result.error) {
      setLoading(false)
      setError(result.error)
      return
    }

    // Navigate here rather than redirecting inside the action: a server-action
    // `redirect()` works by throwing, and this action is awaited from an event
    // handler rather than a form action, so the throw would never reach the
    // router. `refresh()` makes the layout re-read the new session cookie.
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-4">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="w-full h-11 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {error && (
        <p className="text-sm text-destructive mb-4" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {isLoading ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  )
}
