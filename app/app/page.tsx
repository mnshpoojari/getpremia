'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase-client'

// ── Data ───────────────────────────────────────────────────────────────────────

const SECTORS_LIST = [
  { id: 'climate',    label: 'Climate Infrastructure' },
  { id: 'health',     label: 'Healthcare IT' },
  { id: 'fintech',    label: 'Fintech' },
  { id: 'saas',       label: 'B2B SaaS' },
  { id: 'wealth',     label: 'Wealthtech' },
  { id: 'logistics',  label: 'Logistics' },
  { id: 'defence',    label: 'Defence & Aerospace' },
  { id: 'agritech',   label: 'Agritech' },
  { id: 'femtech',    label: 'Femtech' },
  { id: 'realestate', label: 'Real Estate' },
  { id: 'proptech',   label: 'PropTech' },
  { id: 'edtech',     label: 'EdTech' },
]

const GEOS_LIST = [
  { id: 'india',   label: 'India' },
  { id: 'us',      label: 'United States' },
  { id: 'sea',     label: 'Southeast Asia' },
  { id: 'uk',      label: 'United Kingdom' },
  { id: 'mena',    label: 'Middle East' },
  { id: 'germany', label: 'Germany' },
  { id: 'brazil',  label: 'Brazil' },
  { id: 'japan',   label: 'Japan' },
  { id: 'africa',  label: 'Africa' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMarketStatus() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
  try {
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    const mins = et.getHours() * 60 + et.getMinutes()
    const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960
    return { dateStr, open }
  } catch { return { dateStr, open: false } }
}

function computeAccel(count_30d: number, count_90d: number) {
  const recent = count_30d / 30
  const prior = Math.max((count_90d - count_30d) / 60, 0.01)
  return Math.round((recent / prior - 1) * 100)
}

function useIsMobile(breakpoint = 700) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

// ── SectionDivider ─────────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.12)' }} />
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.12)' }} />
    </div>
  )
}

// ── TypeOrDrop ─────────────────────────────────────────────────────────────────

interface Opt { id: string; label: string }

function TypeOrDrop({ label, value, onChange, options, color, accent, onEnter }: {
  label: string; value: string; onChange: (v: string) => void
  options: Opt[]; color?: string; accent?: string; onEnter?: () => void
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Ref tracks current text so onBlur closure doesn't capture stale value
  const textRef = useRef(text)

  useEffect(() => { setText(value) }, [value])
  useEffect(() => { textRef.current = text }, [text])

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    return !q ? options : options.filter(o => o.label.toLowerCase().includes(q))
  }, [text, options])

  const commit = (lbl: string) => { onChange(lbl); setText(lbl); textRef.current = lbl; setOpen(false); inputRef.current?.blur() }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(h => Math.min(filtered.length - 1, h + 1)); setOpen(true) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered.length > 0) {
        commit((filtered[hoverIdx] ?? filtered[0]).label)
      } else {
        onEnter?.()
      }
    }
    else if (e.key === 'Escape') setOpen(false)
  }

  const filled = !!value
  return (
    <div style={{ position: 'relative', flex: '1 1 0', minHeight: 66, borderRadius: 12, background: filled ? (color || 'rgba(163,230,53,.14)') : 'rgba(255,255,255,.55)', border: filled ? `1.5px solid ${accent || 'rgba(124,181,24,.55)'}` : '1.5px solid rgba(43,37,32,.18)', padding: '10px 14px 12px', transition: 'background .2s, border-color .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 2 }}>{label}</div>
          <input ref={inputRef} value={text}
            onChange={e => { setText(e.target.value); onChange(e.target.value); setOpen(true); setHoverIdx(0) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => { setOpen(false); onChange(textRef.current.trim()) }, 150)}
            onKeyDown={onKey}
            placeholder="type or pick…"
            style={{ border: 0, outline: 'none', background: 'transparent', font: `400 18px/1.2 var(--font-serif, 'Young Serif', Georgia, serif)`, color: 'var(--ink)', width: '100%', padding: '2px 0' }}
          />
        </div>
        {filled && <button onMouseDown={e => { e.preventDefault(); setText(''); onChange('') }} style={{ appearance: 'none', border: 0, background: 'transparent', color: 'var(--ink-mute)', fontSize: 18, cursor: 'default', padding: 4, lineHeight: 1 }}>×</button>}
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: '#FAF8F3', border: '1px solid rgba(43,37,32,.18)', borderRadius: 10, boxShadow: '0 14px 30px -16px rgba(43,37,32,.35)', padding: 6, maxHeight: 220, overflowY: 'auto' }}>
          {filtered.slice(0, 8).map((o, i) => (
            <div key={o.id} onMouseDown={e => { e.preventDefault(); commit(o.label) }} onMouseEnter={() => setHoverIdx(i)}
              style={{ padding: '7px 10px', borderRadius: 6, cursor: 'default', background: hoverIdx === i ? 'rgba(163,230,53,.22)' : 'transparent', font: '500 14px Instrument Sans', color: 'var(--ink)' }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ChipRow ────────────────────────────────────────────────────────────────────

function ChipRow({ items, kind, active, onSelect }: { items: Opt[]; kind: 'sector' | 'geo'; active: string; onSelect: (l: string) => void }) {
  const [lifted, setLifted] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(item => {
        const isLifted = lifted === item.id
        const isActive = active === item.label
        return (
          <button key={item.id}
            onClick={() => onSelect(item.label)}
            onPointerDown={() => setLifted(item.id)}
            onPointerUp={() => { setLifted(null); onSelect(item.label) }}
            onPointerLeave={() => setLifted(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
              border: `1px solid ${isActive ? 'rgba(124,181,24,.55)' : isLifted ? 'rgba(43,37,32,.35)' : 'rgba(43,37,32,.18)'}`,
              background: isActive ? 'rgba(163,230,53,.18)' : isLifted ? '#FAF8F3' : 'rgba(255,255,255,.55)',
              color: 'var(--ink)', font: `600 12px var(--font-sans, 'Instrument Sans', sans-serif)`, cursor: 'grab',
              transform: isLifted ? 'scale(1.1) translateY(-4px) rotate(-1deg)' : 'scale(1) translateY(0)',
              boxShadow: isLifted ? '0 12px 28px -8px rgba(43,37,32,.3), 0 2px 0 rgba(255,255,255,.7) inset' : 'none',
              transition: isLifted ? 'transform .08s ease-out, box-shadow .08s ease-out' : 'all .18s ease',
              zIndex: isLifted ? 20 : 1,
              position: 'relative',
              userSelect: 'none',
              touchAction: 'none',
            }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: kind === 'sector' ? 'var(--terra)' : 'var(--accent-deep)', flexShrink: 0 }} />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ── SignalBoard ────────────────────────────────────────────────────────────────

const HERO_SECTORS = ['Healthcare', 'Fintech', 'Real Estate', 'Climatetech', 'Logistics', 'Agritech', 'B2B SaaS']
const HERO_GEOS    = ['India', 'the USA', 'the UAE', 'Germany', 'Brazil', 'Indonesia', 'Nigeria']

function SignalBoard({ onAnalyse, onPin, isMobile, preset }: {
  onAnalyse: (t: string) => void; onPin: (s: string, g: string) => void
  isMobile: boolean; preset?: { sector: string; geo: string } | null
}) {
  const [sector, setSector] = useState('')
  const [geo, setGeo] = useState('')
  const [shuffle, setShuffle] = useState(0)
  const [btnPressed, setBtnPressed] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [heroSectorIdx, setHeroSectorIdx] = useState(0)
  const [heroGeoIdx,    setHeroGeoIdx]    = useState(0)
  const [heroSectorKey, setHeroSectorKey] = useState(0)
  const [heroGeoKey,    setHeroGeoKey]    = useState(0)
  const ready = !!(sector && geo)

  useEffect(() => {
    if (preset) { setSector(preset.sector); setGeo(preset.geo) }
  }, [preset])

  // Sector rotates every 3.5s
  useEffect(() => {
    const id = setInterval(() => {
      setHeroSectorIdx(i => (i + 1) % HERO_SECTORS.length)
      setHeroSectorKey(k => k + 1)
    }, 3500)
    return () => clearInterval(id)
  }, [])

  // Geography rotates every 3.5s, staggered 1.75s behind sector
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        setHeroGeoIdx(i => (i + 1) % HERO_GEOS.length)
        setHeroGeoKey(k => k + 1)
      }, 3500)
    }, 1750)
    return () => { clearTimeout(timeoutId); clearInterval(intervalId) }
  }, [])

  const sectorPool = useMemo(() => {
    const pool = SECTORS_LIST.filter(s => s.label !== sector)
    const start = (shuffle * 4) % pool.length
    return [...pool.slice(start), ...pool.slice(0, start)].slice(0, isMobile ? 5 : 7)
  }, [sector, shuffle, isMobile])

  const geoPool = useMemo(() => {
    const pool = GEOS_LIST.filter(g => g.label !== geo)
    const start = (shuffle * 3) % pool.length
    return [...pool.slice(start), ...pool.slice(0, start)]
  }, [geo, shuffle])

  return (
    <section className="paper" style={{ padding: isMobile ? '20px 18px 24px' : '28px 30px 32px', overflow: 'visible' }}>
      <div className="pin" style={{ top: 10, left: 14 }} />
      <div className="pin brass" style={{ top: 10, right: 14 }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 className="serif" style={{ fontSize: isMobile ? 26 : 38, lineHeight: 1.15, margin: 0 }}>
            Is{' '}
            <span key={heroSectorKey} className="word-in" style={{ display: 'inline-block', color: 'var(--accent-deep)', borderBottom: '2px solid var(--accent-deep)', paddingBottom: 1, whiteSpace: 'nowrap' }}>
              {HERO_SECTORS[heroSectorIdx]}
            </span>
            {' '}in{' '}
            <span key={heroGeoKey + 100} className="word-in" style={{ display: 'inline-block', color: 'var(--terra)', borderBottom: '2px solid var(--terra)', paddingBottom: 1, whiteSpace: 'nowrap' }}>
              {HERO_GEOS[heroGeoIdx]}
            </span>
            {' '}overcrowded or still early?
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: isMobile ? 13 : 15, color: 'var(--ink-soft)', maxWidth: 560 }}>
            Type a sector and country. Get an analysis in seconds.
          </p>
        </div>
        {!isMobile && (
          <button onClick={() => setShuffle(s => s + 1)} style={{
            flexShrink: 0, appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: 'rgba(255,255,255,.4)',
            padding: '8px 14px', borderRadius: 999, fontFamily: 'inherit', fontWeight: 500, fontSize: 12, color: 'var(--ink-soft)', cursor: 'default', letterSpacing: '.04em', marginTop: 4,
          }}>↻ reshuffle</button>
        )}
      </div>

      {/* Input row — stacks on mobile */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 12, alignItems: 'stretch', margin: '18px 0 16px' }}>
        <TypeOrDrop label="Sector" value={sector} onChange={setSector} options={SECTORS_LIST} color="rgba(184,58,38,.10)" accent="rgba(184,58,38,.5)"
          onEnter={() => { if (ready) { setBtnPressed(true); setTimeout(() => { setBtnPressed(false); onAnalyse(`${sector} in ${geo}`) }, 120) } }} />
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, color: 'var(--ink-mute)', font: `400 16px var(--font-serif, 'Young Serif', Georgia, serif)` }}>in</div>
        )}
        <TypeOrDrop label="Geography" value={geo} onChange={setGeo} options={GEOS_LIST} color="rgba(163,230,53,.16)" accent="rgba(124,181,24,.55)"
          onEnter={() => { if (ready) { setBtnPressed(true); setTimeout(() => { setBtnPressed(false); onAnalyse(`${sector} in ${geo}`) }, 120) } }} />
        <button
          disabled={!ready}
          onClick={() => ready && onAnalyse(`${sector} in ${geo}`)}
          onPointerDown={() => ready && setBtnPressed(true)}
          onPointerUp={() => setBtnPressed(false)}
          onPointerLeave={() => setBtnPressed(false)}
          style={{
            appearance: 'none', border: 0,
            background: ready ? 'var(--accent)' : 'rgba(43,37,32,.10)',
            color: ready ? '#1a1a1a' : 'var(--ink-mute)',
            fontFamily: 'inherit', fontWeight: 600, fontSize: 14,
            padding: isMobile ? '14px 22px' : '0 22px',
            borderRadius: 12,
            minWidth: isMobile ? 'unset' : 120,
            width: isMobile ? '100%' : 'auto',
            cursor: ready ? 'default' : 'not-allowed',
            boxShadow: ready
              ? btnPressed
                ? '0 1px 3px -2px rgba(124,181,24,.4)'
                : '0 6px 14px -8px rgba(124,181,24,.7), 0 1px 0 rgba(255,255,255,.5) inset'
              : 'none',
            transform: btnPressed ? 'scale(0.96) translateY(1px)' : 'scale(1) translateY(0)',
            transition: btnPressed ? 'transform .06s ease-out, box-shadow .06s ease-out' : 'all .15s ease',
          }}>Analyse →</button>
      </div>

      {/* Chips — single column on mobile, two columns on desktop */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8 }}>SECTORS</div>
          <ChipRow items={sectorPool} kind="sector" active={sector} onSelect={setSector} />
        </div>
        <div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8 }}>GEOGRAPHIES</div>
          <ChipRow items={geoPool} kind="geo" active={geo} onSelect={setGeo} />
        </div>
      </div>

      {/* Reshuffle — mobile only, below chips */}
      {isMobile && (
        <button onClick={() => setShuffle(s => s + 1)} style={{
          width: '100%', appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: 'rgba(255,255,255,.4)',
          padding: '8px 14px', borderRadius: 999, fontFamily: 'inherit', fontWeight: 500, fontSize: 12, color: 'var(--ink-soft)', cursor: 'default', letterSpacing: '.04em', marginBottom: 16,
        }}>↻ reshuffle chips</button>
      )}

      {/* Verdict strip */}
      <div style={{ padding: isMobile ? '14px 16px' : '18px 22px', borderRadius: 12, background: '#FAF8F3', border: '1px solid rgba(43,37,32,.10)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ backgroundImage: 'linear-gradient(to bottom, transparent calc(100% - 1px), rgba(43,37,32,.06) 100%)', backgroundSize: '100% 22px', position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          {ready ? (
            <div>
              <div className="serif" style={{ fontSize: isMobile ? 17 : 20, color: 'var(--ink)', marginBottom: 8 }}>
                {sector} in {geo} — ready to analyse.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <button
                    onClick={() => { onPin(sector, geo); setPinned(true); setTimeout(() => setPinned(false), 2200) }}
                    style={{ appearance: 'none', border: '1px solid rgba(124,181,24,.55)', background: 'rgba(163,230,53,.18)', color: 'var(--ink)', font: '600 12px Instrument Sans', padding: '7px 14px', borderRadius: 999, cursor: 'default' }}
                  >Pin to Pad</button>
                  {pinned && (
                    <span className="mono" style={{ fontSize: 10, color: '#7CB518', letterSpacing: '.08em', animation: 'fade-in .15s ease' }}>
                      Pinned to Ideas Pad!
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onAnalyse(`${sector} in ${geo}`)}
                  onPointerDown={() => setBtnPressed(true)}
                  onPointerUp={() => setBtnPressed(false)}
                  onPointerLeave={() => setBtnPressed(false)}
                  style={{ appearance: 'none', border: 0, background: 'var(--accent)', color: '#1a1a1a', font: '600 13px Instrument Sans', padding: '7px 18px', borderRadius: 999, cursor: 'default',
                    boxShadow: btnPressed ? '0 1px 2px -1px rgba(124,181,24,.4)' : '0 4px 10px -6px rgba(124,181,24,.7)',
                    transform: btnPressed ? 'scale(0.96) translateY(1px)' : 'scale(1)',
                    transition: btnPressed ? 'transform .06s ease-out, box-shadow .06s ease-out' : 'all .15s ease',
                  }}>Full analysis →</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 8px', borderRadius: 999, background: 'rgba(140,126,111,.14)', color: 'var(--ink-mute)', font: `600 11px var(--font-mono, monospace)`, letterSpacing: '.1em' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-mute)', display: 'inline-block' }} />
                  — PICK ONE OF EACH —
                </span>
              </div>
              <div className="serif" style={{ fontSize: isMobile ? 16 : 19, lineHeight: 1.3, color: 'var(--ink-mute)', maxWidth: 480 }}>
                Your verdict appears here once both are selected.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── ThesisPad ─────────────────────────────────────────────────────────────────

interface PadNote { id: string; text: string; state: string; x: number; y: number; tilt: number; deals30: number; deals90: number; media: number }

const NOTE_COLORS: Record<string, { bg: string; tape: string }> = {
  'EARLY SIGNAL': { bg: '#E9F4C9', tape: 'rgba(124,181,24,.45)' },
  'CONSENSUS':    { bg: '#F2E8CC', tape: 'rgba(168,139,76,.5)'  },
  'HYPE':         { bg: '#F4D5C8', tape: 'rgba(184,58,38,.5)'   },
  'QUIET':        { bg: '#E6E1D5', tape: 'rgba(140,126,111,.5)' },
  'ACTIVE':       { bg: '#F2E8CC', tape: 'rgba(168,139,76,.5)'  },
  'ESTABLISHED':  { bg: '#E9F4C9', tape: 'rgba(124,181,24,.45)' },
  'NARRATIVE':    { bg: '#F4D5C8', tape: 'rgba(184,58,38,.5)'   },
  'COOLING':      { bg: '#E6E1D5', tape: 'rgba(140,126,111,.5)' },
}

function PadNote({ note, onMove, onRemove, onSelect }: {
  note: PadNote
  onMove: (id: string, p: { x: number; y: number }) => void
  onRemove: (id: string) => void
  onSelect: (text: string) => void
}) {
  const [local, setLocal] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const startRef = useRef({ mx: 0, my: 0 })
  const colors = NOTE_COLORS[note.state] || NOTE_COLORS['QUIET']

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    setDragging(true); startRef.current = { mx: e.clientX, my: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent) => { if (dragging) setLocal({ x: e.clientX - startRef.current.mx, y: e.clientY - startRef.current.my }) }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startRef.current.mx
    const dy = e.clientY - startRef.current.my
    const moved = Math.sqrt(dx * dx + dy * dy)
    setDragging(false)
    if (moved < 8) {
      onSelect(note.text)
    } else {
      onMove(note.id, { x: note.x + local.x, y: note.y + local.y })
    }
    setLocal({ x: 0, y: 0 })
  }

  return (
    <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onMouseEnter={() => { setHovered(true); onSelect(note.text) }} onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', left: note.x + local.x, top: note.y + local.y, width: 175, minHeight: 110, background: colors.bg, padding: '14px 14px 12px', borderRadius: 2,
        boxShadow: dragging ? '0 24px 40px -16px rgba(43,37,32,.4)' : hovered ? '0 12px 28px -10px rgba(43,37,32,.35), 0 0 0 2px rgba(124,181,24,.5)' : '0 8px 18px -10px rgba(43,37,32,.3), 0 1px 0 rgba(255,255,255,.5) inset',
        transform: `rotate(${note.tilt}deg) ${dragging ? 'scale(1.02)' : hovered ? 'scale(1.02) translateY(-2px)' : ''}`,
        transition: dragging ? 'none' : 'transform .18s, box-shadow .18s', cursor: dragging ? 'grabbing' : 'pointer', userSelect: 'none', touchAction: 'none', zIndex: dragging ? 30 : hovered ? 20 : 1 }}>
      <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2deg)', width: 70, height: 18, background: colors.tape, boxShadow: '0 2px 4px rgba(0,0,0,.08)' }} />
      <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', color: 'rgba(43,37,32,.55)' }}>{note.state}</div>
      <div className="serif" style={{ fontSize: 15, lineHeight: 1.25, marginTop: 6, color: 'var(--ink)' }}>{note.text}</div>
      <div className="mono" style={{ marginTop: 10, fontSize: 10, color: 'rgba(43,37,32,.55)', letterSpacing: '.06em' }}>{note.deals30}d/30 · {note.deals90}d/90 · {note.media}m</div>
      {hovered && <div className="mono" style={{ marginTop: 6, fontSize: 8, letterSpacing: '.12em', color: 'rgba(124,181,24,.8)' }}>LOADED ABOVE · CLICK TO ANALYSE ↑</div>}
      <button onClick={e => { e.stopPropagation(); onRemove(note.id) }} style={{ position: 'absolute', top: 6, right: 6, appearance: 'none', border: 0, background: 'transparent', color: 'rgba(43,37,32,.4)', fontSize: 14, cursor: 'default', padding: 4 }}>×</button>
    </div>
  )
}

function ThesisPad({ notes, setNotes, isMobile, onSelect, onRemove: onRemoveProp, onMove: onMoveProp }: {
  notes: PadNote[]
  setNotes: React.Dispatch<React.SetStateAction<PadNote[]>>
  isMobile: boolean
  onSelect: (text: string) => void
  onRemove?: (id: string) => void
  onMove?: (id: string, p: { x: number; y: number }) => void
}) {
  const onMove = (id: string, p: { x: number; y: number }) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...p } : n))
    onMoveProp?.(id, p)
  }
  const onRemove = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id))
    onRemoveProp?.(id)
  }
  const boardH = isMobile ? 220 : 320

  return (
    <div>
      <SectionDivider label="YOUR IDEAS PAD" />
      <div style={{ marginTop: 14 }}>
        <div style={{ position: 'relative', height: boardH, borderRadius: 14, background: '#3A2A1E',
          backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 6px), url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='c'><feTurbulence baseFrequency='1.4' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.13  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23c)'/></svg>")`,
          boxShadow: '0 14px 30px -20px rgba(43,37,32,.5), 0 0 0 7px #5A3D24, 0 0 0 8px #2B1B0F', overflow: 'hidden' }}>
          <div className="pin brass" style={{ top: 14, left: 14 }} />
          <div className="pin brass" style={{ top: 14, right: 14 }} />
          <div className="pin brass" style={{ bottom: 14, left: 14 }} />
          <div className="pin brass" style={{ bottom: 14, right: 14 }} />
          <div className="mono" style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, letterSpacing: '.24em', color: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap' }}>IDEAS PAD · drag freely</div>
          {notes.length === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 2, background: '#E9F4C9', opacity: .4, transform: 'rotate(-3deg)' }} />
              <p className="mono" style={{ color: 'rgba(255,255,255,.35)', fontSize: 11, letterSpacing: '.1em', marginTop: 8 }}>Pin a thesis to start your board.</p>
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 32 }}>
              {notes.map(n => <PadNote key={n.id} note={n} onMove={onMove} onRemove={onRemove} onSelect={onSelect} />)}
            </div>
          )}
        </div>
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
          Pinned theses live here. Drag them around, group them, or pluck them off.
        </p>
      </div>
    </div>
  )
}

// ── NeedleMeter ────────────────────────────────────────────────────────────────

function NeedleMeter({ pct, color = '#B83A26' }: { pct: number; color?: string }) {
  const W = 120, H = 36, px = 8 + (W - 16) * Math.max(0, Math.min(1, pct))
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {[0,1,2,3,4].map(i => <line key={i} x1={8+(W-16)*(i/4)} y1={20} x2={8+(W-16)*(i/4)} y2={28} stroke="rgba(43,37,32,.25)" strokeWidth={i%2===0?1.2:.8} />)}
      <line x1={8} y1={24} x2={W-8} y2={24} stroke="rgba(43,37,32,.18)" strokeWidth="1.2" />
      <line x1={px} y1={8} x2={px} y2={30} stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={px} cy={8} r={3} fill={color} />
    </svg>
  )
}

// ── SectorBoard ────────────────────────────────────────────────────────────────

interface SectorData { sector: string; count_30d: number; count_90d: number }

function SectorCard({ rank, sector, count_30d, count_90d, onClick }: { rank: number; sector: string; count_30d: number; count_90d: number; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const pct = Math.min(1, count_30d / 30)
  const accel = computeAccel(count_30d, count_90d)
  const accelColor = accel >= 20 ? '#7CB518' : accel >= 0 ? '#A88B4C' : '#B83A26'
  const accelBg = accel >= 20 ? 'rgba(163,230,53,.16)' : accel >= 0 ? 'rgba(168,139,76,.14)' : 'rgba(184,58,38,.12)'
  const needleColor = count_30d >= 15 ? '#7CB518' : count_30d >= 8 ? '#A88B4C' : '#B83A26'

  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: '100%', textAlign: 'left', background: 'var(--paper)', borderRadius: 14, position: 'relative', overflow: 'hidden',
        border: `1px solid ${hov ? 'rgba(43,37,32,.22)' : 'rgba(43,37,32,.10)'}`,
        boxShadow: hov ? '0 20px 36px -20px rgba(43,37,32,.3), 0 1px 0 rgba(255,255,255,.6) inset' : '0 10px 24px -18px rgba(43,37,32,.25), 0 1px 0 rgba(255,255,255,.6) inset',
        padding: '18px 18px 16px', cursor: 'default', transform: hov ? 'translateY(-2px)' : 'none', transition: 'all .18s' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence baseFrequency='1' numOctaves='1' seed='${rank}'/><feColorMatrix values='0 0 0 0 0.2  0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0.04 0'/></filter><rect width='100%25' height='100%25' filter='url(%23g)'/></svg>")`,
        mixBlendMode: 'multiply', opacity: .5 }} />
      <div className="pin" style={{ top: 8, left: '50%', transform: 'translateX(-50%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 999, background: 'rgba(43,37,32,.08)', color: 'var(--ink-soft)', letterSpacing: '.12em' }}>#{rank}</span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: accelBg, color: accelColor, fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.04em' }}>{accel >= 0 ? '+' : ''}{accel}%</span>
      </div>
      <h3 className="serif" style={{ margin: '12px 0 4px', fontSize: 20, lineHeight: 1.1, color: 'var(--ink)' }}>{sector}</h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span className="num" style={{ fontSize: 42, lineHeight: 1, color: '#B83A26' }}>{count_30d}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>deals · 30d</span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <NeedleMeter pct={pct} color={needleColor} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>velocity</span>
      </div>
    </button>
  )
}

function SectorBoard({ data, loading, onSelect, isMobile }: { data: SectorData[]; loading: boolean; onSelect: (s: string) => void; isMobile: boolean }) {
  const cardW = isMobile ? '78vw' : 'calc(33.33% - 10px)'

  return (
    <div>
      <SectionDivider label="WHAT'S MOVING RIGHT NOW" />
      <div style={{ margin: '14px 0 14px' }}>
        <h2 className="serif" style={{ margin: 0, fontSize: isMobile ? 22 : 26 }}>What&rsquo;s moving right now</h2>
        {!isMobile && <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--ink-mute)' }}>Live deal flow across tracked sectors.</p>}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'row', gap: 14,
        overflowX: 'auto', paddingBottom: 8,
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        {loading
          ? [1,2,3].map(i => <div key={i} className="shimmer" style={{ flex: `0 0 ${cardW}`, height: 220, borderRadius: 14, background: 'var(--paper)', scrollSnapAlign: 'start' }} />)
          : data.map((s, i) => (
              <div key={s.sector} style={{ flex: `0 0 ${cardW}`, minWidth: 0, scrollSnapAlign: 'start' }}>
                <SectorCard rank={i + 1} sector={s.sector} count_30d={s.count_30d} count_90d={s.count_90d} onClick={() => onSelect(s.sector)} />
              </div>
            ))
        }
      </div>
    </div>
  )
}

// ── ReturnBanner ───────────────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  'EARLY SIGNAL': 'Early Signal', 'CONSENSUS': 'Crowded', 'HYPE': 'Hype',
  'QUIET': 'Quiet', 'ACTIVE': 'Active', 'ESTABLISHED': 'Established',
  'NARRATIVE': 'Narrative', 'COOLING': 'Cooling',
}

const STATE_COLORS: Record<string, string> = {
  'EARLY SIGNAL': '#7CB518', 'CONSENSUS': '#A88B4C', 'HYPE': '#B83A26',
  'QUIET': '#8C7E6F', 'ACTIVE': '#A88B4C', 'ESTABLISHED': '#7CB518',
  'NARRATIVE': '#B83A26', 'COOLING': '#8C7E6F',
}

type MovedPin = {
  id: string; text: string; original_state: string; current_state: string
  moved: boolean; direction: 'up' | 'down' | 'none'; weeks_ago: number
}

function ReturnBanner({ moved, onDismiss, onAnalyse }: {
  moved: MovedPin[]
  onDismiss: () => void
  onAnalyse: (text: string) => void
}) {
  const first = moved[0]
  const rest  = moved.length - 1
  const verb  = first.direction === 'up' ? 'is moving' : 'has shifted'
  const ago   = first.weeks_ago > 0 ? ` You marked this ${first.weeks_ago === 1 ? 'a week' : `${first.weeks_ago} weeks`} ago.` : ''

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 200, width: 'calc(100vw - 32px)', maxWidth: 480,
      background: '#1A1611', borderRadius: 14,
      boxShadow: '0 12px 40px -12px rgba(0,0,0,.6)',
      border: '1px solid rgba(255,255,255,.08)',
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.16em', color: 'rgba(245,245,240,.4)', marginBottom: 4 }}>
            YOU CALLED IT
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#F5F5F0', lineHeight: 1.35 }}>
            <span style={{ color: STATE_COLORS[first.current_state] ?? '#A3E635' }}>
              {first.text}
            </span>
            {' '}{verb}.{ago}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'rgba(245,245,240,.5)' }}>
            {STATE_LABELS[first.original_state] ?? first.original_state}
            {' → '}
            <span style={{ color: STATE_COLORS[first.current_state] ?? '#F5F5F0' }}>
              {STATE_LABELS[first.current_state] ?? first.current_state}
            </span>
            {rest > 0 && ` · and ${rest} other${rest > 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={onDismiss} style={{ appearance: 'none', border: 0, background: 'transparent', color: 'rgba(245,245,240,.3)', fontSize: 18, cursor: 'default', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onAnalyse(first.text)}
          style={{ appearance: 'none', border: 0, background: '#A3E635', color: '#1a1a1a', fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, cursor: 'default' }}
        >
          Run analysis →
        </button>
        {rest > 0 && (
          <button
            onClick={onDismiss}
            style={{ appearance: 'none', border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: 'rgba(245,245,240,.6)', fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, cursor: 'default' }}
          >
            See all on pad
          </button>
        )}
      </div>
    </div>
  )
}

// ── AccountDropdown ────────────────────────────────────────────────────────────

function AccountDropdown({ label, onAccount, onSignOut }: { label: string; onAccount: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: open ? 'rgba(43,37,32,.08)' : 'rgba(255,255,255,.55)', color: 'var(--ink)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999, cursor: 'default', transition: 'background .15s' }}
      >
        {label} ↓
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50,
          background: '#FAF8F3', border: '1px solid rgba(43,37,32,.14)', borderRadius: 10,
          boxShadow: '0 8px 24px -8px rgba(43,37,32,.25)', minWidth: 148, overflow: 'hidden',
        }}>
          <button
            onClick={() => { setOpen(false); onAccount() }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 16px', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'transparent', border: 0, cursor: 'default', transition: 'background .12s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(43,37,32,.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            My Account
          </button>
          <div style={{ height: 1, background: 'rgba(43,37,32,.08)', margin: '0 10px' }} />
          <button
            onClick={() => { setOpen(false); onSignOut() }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 16px', fontSize: 13, fontWeight: 500, color: '#B83A26', background: 'transparent', border: 0, cursor: 'default', transition: 'background .12s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(184,58,38,.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── AuthGateModal ──────────────────────────────────────────────────────────────

function AuthGateModal({ reason, onDismiss, onSignUp, onSignIn }: {
  reason: 'analysis' | 'pin'
  onDismiss: () => void
  onSignUp: () => void
  onSignIn: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onDismiss])

  const isAnalysis = reason === 'analysis'

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onDismiss() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(43,37,32,.52)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'fade-in .2s ease',
      }}
    >
      <div style={{
        background: '#FAF8F3', borderRadius: 18, padding: '32px 30px 26px',
        maxWidth: 400, width: '100%',
        boxShadow: '0 28px 60px -20px rgba(43,37,32,.45), 0 1px 0 rgba(255,255,255,.7) inset',
        border: '1px solid rgba(43,37,32,.10)',
      }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '.22em', color: 'var(--accent-deep)', marginBottom: 12 }}>
          {isAnalysis ? '— FREE ANALYSES USED —' : '— IDEAS PAD LIMIT REACHED —'}
        </div>
        <h2 className="serif" style={{ margin: '0 0 10px', fontSize: 26, lineHeight: 1.2, color: 'var(--ink)' }}>
          {isAnalysis ? 'You\'ve used your 3 free analyses.' : 'First idea pinned.'}
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
          {isAnalysis
            ? 'Create a free account to run unlimited analyses. Your Ideas Pad syncs across devices and gets re-checked automatically over time.'
            : 'Create a free account to build your board freely. We\'ll track your pins, re-analyse them, and tell you when a signal shifts.'
          }
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onSignUp}
            style={{ appearance: 'none', border: 0, background: 'var(--accent)', color: '#1a1a1a', fontWeight: 700, fontSize: 14, padding: '13px 20px', borderRadius: 10, cursor: 'default', width: '100%' }}
          >
            Create free account →
          </button>
          <button
            onClick={onSignIn}
            style={{ appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: 'transparent', color: 'var(--ink)', fontWeight: 600, fontSize: 14, padding: '11px 20px', borderRadius: 10, cursor: 'default', width: '100%' }}
          >
            Sign in
          </button>
        </div>
        <button
          onClick={onDismiss}
          style={{ display: 'block', margin: '16px auto 0', appearance: 'none', border: 0, background: 'transparent', color: 'var(--ink-mute)', fontSize: 12, cursor: 'default' }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}

// ── SaveBanner ─────────────────────────────────────────────────────────────────

function SaveBanner({ onDismiss, onSignIn }: { onDismiss: () => void; onSignIn: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 100, display: 'flex', alignItems: 'center', gap: 12,
      background: '#1A1A1A', color: '#F5F5F0', padding: '14px 20px', borderRadius: 12,
      boxShadow: '0 8px 32px -8px rgba(0,0,0,.5)', maxWidth: 'calc(100vw - 32px)',
      animation: 'fade-in .25s ease',
    }}>
      <span style={{ fontSize: 16 }}>📌</span>
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Don&rsquo;t lose this</p>
        <p style={{ margin: '1px 0 0', fontSize: 12, color: 'rgba(245,245,240,.6)' }}>Sign in to save your pinned theses.</p>
      </div>
      <button onClick={onSignIn} style={{ appearance: 'none', border: 0, background: '#A3E635', color: '#1a1a1a', fontWeight: 700, fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'default', whiteSpace: 'nowrap' }}>
        Sign in →
      </button>
      <button onClick={onDismiss} style={{ appearance: 'none', border: 0, background: 'transparent', color: 'rgba(245,245,240,.4)', fontSize: 18, cursor: 'default', padding: '0 4px', lineHeight: 1 }}>×</button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter()
  const { user, loading: authLoading, signOut } = useAuth()
  const [topSectors, setTopSectors] = useState<SectorData[]>([])
  const [sectorsLoading, setSectorsLoading] = useState(true)
  const [padNotes, setPadNotes] = useState<PadNote[]>([])
  const [padPreset, setPadPreset] = useState<{ sector: string; geo: string } | null>(null)
  const [showSaveBanner, setShowSaveBanner] = useState(false)
  const [authGate, setAuthGate] = useState<{ reason: 'analysis' | 'pin' } | null>(null)
  const [movedPins, setMovedPins] = useState<MovedPin[]>([])
  const [showReturnBanner, setShowReturnBanner] = useState(false)
  const [{ dateStr }] = useState(() => getMarketStatus())
  const isMobile = useIsMobile()
  const migratedRef = useRef(false)

  // ── Load pins ──────────────────────────────────────────────────────────────

  // Load from Supabase when signed in, fallback to localStorage
  const loadPins = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('user_pins')
      .select('id,text,state,x,y,tilt,deals30,deals90,media')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })
    if (!error && data) {
      setPadNotes(data as PadNote[])
    }
  }, [])

  // On mount: load top sectors + pins
  useEffect(() => {
    fetch('/api/top-sectors').then(r => r.json()).then(d => { setTopSectors(Array.isArray(d) ? d : []); setSectorsLoading(false) }).catch(() => setSectorsLoading(false))
    try { const s = localStorage.getItem('premia-pad-notes'); if (s) setPadNotes(JSON.parse(s)) } catch (_) {}
  }, [])

  // When auth resolves: load from Supabase + migrate localStorage pins
  useEffect(() => {
    if (authLoading || !user) return
    // Migrate any localStorage pins on first sign-in
    if (!migratedRef.current) {
      migratedRef.current = true
      try {
        const raw = localStorage.getItem('premia-pad-notes')
        if (raw) {
          const local: PadNote[] = JSON.parse(raw)
          if (local.length > 0) {
            const rows = local.map(n => ({ ...n, user_id: user.id }))
            supabase.from('user_pins').upsert(rows, { onConflict: 'id' }).then(() => {
              localStorage.removeItem('premia-pad-notes')
              loadPins(user.id)
            })
            return
          }
        }
      } catch (_) {}
    }
    loadPins(user.id)
  }, [user, authLoading, loadPins])

  // ── Check for moved pins once per 6h after sign-in ────────────────────────

  useEffect(() => {
    if (!user || padNotes.length === 0) return
    const CHECK_KEY = `premia-pin-check-${user.id}`
    const last = localStorage.getItem(CHECK_KEY)
    const sixHours = 6 * 60 * 60 * 1000
    if (last && Date.now() - parseInt(last) < sixHours) return

    // Fetch created_at from Supabase so we can report "X weeks ago"
    supabase
      .from('user_pins')
      .select('id,text,state,created_at')
      .eq('user_id', user.id)
      .then(async ({ data }) => {
        if (!data || data.length === 0) return
        const pins = data.map(p => ({ id: p.id, text: p.text, state: p.state, pinned_at: p.created_at }))
        try {
          const res = await fetch('/api/pins/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pins }),
          })
          if (!res.ok) return
          const { results } = await res.json() as { results: MovedPin[] }
          const moved = results.filter(r => r.moved)
          if (moved.length > 0) {
            setMovedPins(moved)
            setShowReturnBanner(true)
          }
          localStorage.setItem(CHECK_KEY, Date.now().toString())
        } catch {}
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, padNotes.length])

  // ── Save pins to Supabase when signed in, else localStorage ───────────────

  const savePinsRef = useRef<PadNote[]>([])
  savePinsRef.current = padNotes

  const persistNote = useCallback(async (note: PadNote) => {
    if (!user) return
    await supabase.from('user_pins').upsert({ ...note, user_id: user.id }, { onConflict: 'id' })
  }, [user])

  const deleteNote = useCallback(async (id: string) => {
    if (!user) return
    await supabase.from('user_pins').delete().eq('id', id).eq('user_id', user.id)
  }, [user])

  // Sync to localStorage when not signed in
  useEffect(() => {
    if (user) return
    try { localStorage.setItem('premia-pad-notes', JSON.stringify(padNotes)) } catch (_) {}
  }, [padNotes, user])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAnalyse = (thesis: string) => {
    if (!user) {
      const ANON_KEY = 'premia-anon-analysis-count'
      const count = parseInt(localStorage.getItem(ANON_KEY) ?? '0', 10)
      if (count >= 3) {
        setAuthGate({ reason: 'analysis' })
        return
      }
      localStorage.setItem(ANON_KEY, String(count + 1))
    }
    router.push(`/results?thesis=${encodeURIComponent(thesis)}`)
  }

  const handlePadSelect = (text: string) => {
    const idx = text.lastIndexOf(' in ')
    if (idx > 0) setPadPreset({ sector: text.slice(0, idx).trim(), geo: text.slice(idx + 4).trim() })
  }

  const handlePin = (sector: string, geo: string) => {
    if (!user && padNotes.length >= 1) {
      setAuthGate({ reason: 'pin' })
      return
    }
    const note: PadNote = {
      id: crypto.randomUUID(), text: `${sector} in ${geo}`, state: 'QUIET',
      x: 20 + (padNotes.length % 4) * 195, y: 30 + Math.floor(padNotes.length / 4) * 130,
      tilt: (Math.random() - 0.5) * 6, deals30: 0, deals90: 0, media: 0,
    }
    setPadNotes(prev => [...prev, note])
    if (user) {
      persistNote(note)
    } else {
      setShowSaveBanner(true)
    }
  }

  const handleRemoveNote = (id: string) => {
    setPadNotes(prev => prev.filter(n => n.id !== id))
    if (user) deleteNote(id)
  }

  const handleMoveNote = (id: string, p: { x: number; y: number }) => {
    setPadNotes(prev => prev.map(n => n.id === id ? { ...n, ...p } : n))
    if (user) {
      const note = padNotes.find(n => n.id === id)
      if (note) persistNote({ ...note, ...p })
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
      <header style={{ padding: isMobile ? '12px 16px' : '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span className="serif" style={{ fontSize: isMobile ? '1.25rem' : '1.5rem', color: 'var(--ink)', flexShrink: 0 }}>
          Premia<span style={{ color: 'var(--terra)', fontSize: '0.65em', verticalAlign: 'super', marginLeft: 1 }}>·</span>
        </span>
        {!isMobile && (
          <div className="mono" style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--ink-mute)' }}>
            {dateStr}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!authLoading && (
            user ? (
              <AccountDropdown
                label={user.email?.split('@')[0] ?? 'Account'}
                onAccount={() => router.push('/account')}
                onSignOut={async () => { await signOut(); router.refresh() }}
              />
            ) : (
              <button onClick={() => router.push('/auth')} style={{ appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: 'rgba(255,255,255,.55)', color: 'var(--ink)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999, cursor: 'default' }}>
                Sign in
              </button>
            )
          )}
          <button onClick={() => router.push('/brief')} className="btn-glow"
            style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', fontWeight: 600, padding: isMobile ? '5px 12px' : '6px 16px', borderRadius: 999, color: '#3B2F2F', backgroundColor: '#A3E635', border: 'none', cursor: 'default', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {isMobile ? 'Brief →' : 'News Brief of the Day! →'}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '4px 14px 48px' : '8px 32px 60px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 24 }}>
          <SignalBoard onAnalyse={handleAnalyse} onPin={handlePin} isMobile={isMobile} preset={padPreset} />
          <ThesisPad
            notes={padNotes}
            setNotes={setPadNotes}
            isMobile={isMobile}
            onSelect={handlePadSelect}
            onRemove={handleRemoveNote}
            onMove={handleMoveNote}
          />
          <SectorBoard data={topSectors} loading={sectorsLoading} onSelect={handleAnalyse} isMobile={isMobile} />
        </div>
      </main>

      <footer style={{ padding: isMobile ? '12px 16px' : '16px 32px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--ink-mute)' }}>
        Premia · Understanding where money is moving
        <span style={{ margin: '0 8px' }}>·</span>
        <a href="mailto:manishapoojari48@gmail.com" style={{ color: 'var(--ink-soft)', fontWeight: 600, textDecoration: 'none' }}>Contact</a>
      </footer>

      {authGate && (
        <AuthGateModal
          reason={authGate.reason}
          onDismiss={() => setAuthGate(null)}
          onSignUp={() => router.push('/auth?reason=signup')}
          onSignIn={() => router.push('/auth')}
        />
      )}

      {showSaveBanner && !user && !authGate && (
        <SaveBanner
          onDismiss={() => setShowSaveBanner(false)}
          onSignIn={() => router.push('/auth?reason=pin')}
        />
      )}

      {showReturnBanner && movedPins.length > 0 && (
        <ReturnBanner
          moved={movedPins}
          onDismiss={() => setShowReturnBanner(false)}
          onAnalyse={text => { setShowReturnBanner(false); handleAnalyse(text) }}
        />
      )}
    </div>
  )
}
