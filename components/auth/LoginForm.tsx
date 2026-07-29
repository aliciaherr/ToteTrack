'use client'

import { useState } from 'react'
import { signIn } from '@/lib/actions/auth'

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value

    if (!password) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    setError(null)
    const result = await signIn(password)
    setLoading(false)
    if (result?.error) setError(result.error)
  }

  return (
    // method="POST" is the pre-hydration fallback only — with JS loaded, handleSubmit
    // preventDefaults the native submit. Without it, a pre-hydration submit degrades to
    // GET and puts the password in the URL/server logs (QA finding 2, 2026-07-28).
    <form method="POST" onSubmit={handleSubmit} noValidate>
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
