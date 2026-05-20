'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase-client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pin {
  id: string
  text: string
  state: string
  deals30: number
  deals90: number
  media: number
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATE_META: Record<string, { color: string; bg: string; label: string }> = {
  'EARLY SIGNAL': { color: '#7CB518', bg: 'rgba(163,230,53,.18)', label: 'Early Signal' },
  'CONSENSUS':    { color: '#A88B4C', bg: 'rgba(168,139,76,.16)', label: 'Crowded' },
  'HYPE':         { color: '#B83A26', bg: 'rgba(184,58,38,.12)', label: 'Hype' },
  'QUIET':        { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'Quiet' },
  'ACTIVE':       { color: '#A88B4C', bg: 'rgba(168,139,76,.16)', label: 'Active' },
  'ESTABLISHED':  { color: '#7CB518', bg: 'rgba(163,230,53,.18)', label: 'Established' },
  'NARRATIVE':    { color: '#B83A26', bg: 'rgba(184,58,38,.12)', label: 'Narrative' },
  'COOLING':      { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'Cooling' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function avatarInitials(email: string): string {
  return email.charAt(0).toUpperCase()
}

// ── PinRow ─────────────────────────────────────────────────────────────────────

function PinRow({ pin, onAnalyse, onRemove }: { pin: Pin; onAnalyse: () => void; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [removing, setRemoving] = useState(false)
  const meta = STATE_META[pin.state] ?? STATE_META['QUIET']

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setRemoving(true)
    onRemove()
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 20px', borderRadius: 12,
        background: hovered ? 'rgba(43,37,32,.04)' : 'transparent',
        border: '1px solid rgba(43,37,32,.10)',
        transition: 'background .15s, border-color .15s',
        opacity: removing ? 0.4 : 1,
        cursor: 'default',
      }}
    >
      {/* State badge */}
      <div style={{
        flexShrink: 0, width: 10, height: 10, borderRadius: '50%',
        background: meta.color,
      }} />

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="serif" style={{ fontSize: 16, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 4 }}>
          {pin.text}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            background: meta.bg, color: meta.color, fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '.06em',
          }}>
            {meta.label}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {pin.deals30}d/30 · {pin.deals90}d/90 · {pin.media}m
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            pinned {formatDate(pin.created_at)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onAnalyse}
          style={{
            appearance: 'none', border: '1px solid rgba(43,37,32,.18)',
            background: hovered ? 'var(--ink)' : 'rgba(255,255,255,.6)',
            color: hovered ? 'var(--paper)' : 'var(--ink)',
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999,
            cursor: 'default', transition: 'all .15s', whiteSpace: 'nowrap',
          }}
        >
          Re-run →
        </button>
        <button
          onClick={handleRemove}
          style={{
            appearance: 'none', border: 0, background: 'transparent',
            color: 'rgba(43,37,32,.3)', fontSize: 16, cursor: 'default',
            padding: '4px 6px', lineHeight: 1, transition: 'color .15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#B83A26')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(43,37,32,.3)')}
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ── Account Page ──────────────────────────────────────────────────────────────

export default function AccountPage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const router = useRouter()
  const [pins, setPins] = useState<Pin[]>([])
  const [pinsLoading, setPinsLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth')
    }
  }, [authLoading, user, router])

  // Load pins
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_pins')
      .select('id,text,state,deals30,deals90,media,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPins((data as Pin[]) ?? [])
        setPinsLoading(false)
      })
  }, [user])

  const handleRemove = async (id: string) => {
    setPins(prev => prev.filter(p => p.id !== id))
    await supabase.from('user_pins').delete().eq('id', id)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    router.push('/')
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <p className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', letterSpacing: '.12em' }}>Loading…</p>
      </div>
    )
  }

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined
  const displayName = (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'You'
  const email = user.email ?? ''

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      {/* Header */}
      <header style={{ padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(43,37,32,.08)' }}>
        <a href="/" className="serif" style={{ fontSize: '1.5rem', color: 'var(--ink)', textDecoration: 'none' }}>
          Premia<span style={{ color: 'var(--terra)', fontSize: '0.65em', verticalAlign: 'super', marginLeft: 1 }}>·</span>
        </a>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            appearance: 'none', border: '1px solid rgba(43,37,32,.18)',
            background: 'transparent', color: 'var(--ink-mute)',
            fontSize: 13, fontWeight: 500, padding: '6px 16px', borderRadius: 999,
            cursor: 'default', transition: 'all .15s',
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Profile card */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20,
          padding: '28px 28px', borderRadius: 16,
          background: '#FAF8F3', border: '1px solid rgba(43,37,32,.10)',
          boxShadow: '0 2px 16px -8px rgba(43,37,32,.12)',
          marginBottom: 36,
        }}>
          {/* Avatar */}
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} width={56} height={56}
              style={{ borderRadius: '50%', flexShrink: 0, border: '2px solid rgba(43,37,32,.10)' }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
              background: 'var(--terra)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="serif" style={{ fontSize: 22, color: '#fff' }}>{avatarInitials(email)}</span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 22, color: 'var(--ink)', marginBottom: 2 }}>{displayName}</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', letterSpacing: '.04em' }}>{email}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="num" style={{ fontSize: 32, lineHeight: 1, color: 'var(--terra)' }}>{pins.length}</div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-mute)', marginTop: 2 }}>
              {pins.length === 1 ? 'PIN' : 'PINS'}
            </div>
          </div>
        </div>

        {/* Pinned theses */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.10)' }} />
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', fontWeight: 600 }}>YOUR PINNED THESES</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.10)' }} />
          </div>

          {pinsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="shimmer" style={{ height: 76, borderRadius: 12 }} />
              ))}
            </div>
          ) : pins.length === 0 ? (
            <div style={{
              padding: '48px 24px', textAlign: 'center', borderRadius: 12,
              border: '1px dashed rgba(43,37,32,.18)',
            }}>
              <div className="serif" style={{ fontSize: 18, color: 'var(--ink-mute)', marginBottom: 8 }}>No pins yet</div>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '0 0 20px' }}>
                Run an analysis and hit "Pin" to track it here.
              </p>
              <button
                onClick={() => router.push('/app')}
                style={{
                  appearance: 'none', border: 0, background: 'var(--accent)',
                  color: '#1a1a1a', fontSize: 13, fontWeight: 600,
                  padding: '8px 20px', borderRadius: 999, cursor: 'default',
                }}
              >
                Start analysing →
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pins.map(pin => (
                <PinRow
                  key={pin.id}
                  pin={pin}
                  onAnalyse={() => router.push(`/results?thesis=${encodeURIComponent(pin.text)}`)}
                  onRemove={() => handleRemove(pin.id)}
                />
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
