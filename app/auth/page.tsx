'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

function AuthPageInner() {
  const { signInWithGoogle, signInWithEmail } = useAuth()
  const searchParams = useSearchParams()

  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    const { error } = await signInWithEmail(email.trim())
    setLoading(false)
    if (error) {
      setError(error)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'var(--paper)' }}>
      {/* Wordmark */}
      <Link href="/" className="serif text-2xl tracking-tight mb-12" style={{ color: 'var(--ink)' }}>
        Premia
      </Link>

      <div
        className="w-full max-w-sm rounded-xl p-8 flex flex-col gap-6"
        style={{ background: 'var(--paper)', border: '1px solid var(--ink-soft)', boxShadow: '0 2px 24px rgba(0,0,0,0.06)' }}
      >
        {/* Heading */}
        <div className="flex flex-col gap-1">
          <h1 className="serif text-xl" style={{ color: 'var(--ink)' }}>
            {searchParams.get('reason') === 'pin' ? "Don't lose this" : 'Welcome back'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
            {searchParams.get('reason') === 'pin'
              ? 'Sign in to save your pinned theses and pick up where you left off.'
              : 'Sign in to access your saved theses and conviction tracker.'}
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col gap-3 text-center py-4">
            <div className="text-2xl">✉️</div>
            <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Check your inbox</p>
            <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
              We sent a sign-in link to <span className="font-medium" style={{ color: 'var(--ink)' }}>{email}</span>.
              No password needed.
            </p>
          </div>
        ) : (
          <>
            {/* Google OAuth */}
            <button
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'var(--ink-soft)' }} />
              <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--ink-soft)' }} />
            </div>

            {/* Email magic link */}
            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--ink-soft)',
                  color: 'var(--ink)',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--terra)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--ink-soft)')}
              />
              {error && (
                <p className="text-xs" style={{ color: '#c0392b' }}>{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--terra)', color: '#fff' }}
              >
                {loading ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="mt-8 text-xs text-center" style={{ color: 'var(--ink-mute)', maxWidth: 280 }}>
        By signing in you agree to our terms. We don&apos;t share your data or send marketing email.
      </p>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageInner />
    </Suspense>
  )
}
