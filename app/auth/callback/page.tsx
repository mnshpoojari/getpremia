'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    // Supabase reads the hash/query params and establishes the session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/app')
      } else {
        // Try to exchange code if using PKCE
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          supabase.auth.exchangeCodeForSession(code).then(() => {
            router.replace('/app')
          })
        } else {
          router.replace('/app')
        }
      }
    })
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
      <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>Signing you in…</p>
    </div>
  )
}
