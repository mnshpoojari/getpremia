'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Brief { date: string; content: string; generated_at: string }
interface SectorData { sector: string; count_30d: number; count_90d: number }
interface UnderratedData { sector: string; count_30d: number; momentum: number }

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

// ── Content parser ────────────────────────────────────────────────────────────

type Block =
  | { type: 'section'; text: string }
  | { type: 'deal'; headline: string; url: string; body: string }
  | { type: 'para'; text: string }

function parseContent(raw: string): Block[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const skip = new Set<number>()
  const blocks: Block[] = []

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue
    const line = lines[i]

    // Section header: **Title**
    if (/^\*\*[^*]+\*\*$/.test(line)) {
      blocks.push({ type: 'section', text: line.slice(2, -2) })
      continue
    }

    // Bare URL line — already consumed by look-ahead below, skip
    if (/^https?:\/\//.test(line)) continue

    // If the very next line is a bare URL, this paragraph is a sourced item
    const nextLine = lines[i + 1]
    if (nextLine && /^https?:\/\//.test(nextLine)) {
      skip.add(i + 1)
      blocks.push({ type: 'deal', headline: line, url: nextLine, body: '' })
      continue
    }

    blocks.push({ type: 'para', text: line })
  }
  return blocks
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 600, color: 'var(--ink)' }}>{part.slice(2, -2)}</strong>
      : part
  )
}

function getDomain(url: string) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

function getDealType(headline: string) {
  const h = headline.toLowerCase()
  if (h.includes('acquir') || h.includes(' buys ') || h.includes('merger') || h.includes('takeover')) return 'M&A'
  if (h.includes('raises') || h.includes('closes') && h.includes('fund') || h.includes('fundrais')) return 'FUNDRAISE'
  if (h.includes('roll-up') || h.includes('bolt-on') || h.includes('tuck-in')) return 'BOLT-ON'
  if (h.includes('joint venture') || h.includes(' jv ')) return 'JV'
  if (h.includes('ipo') || h.includes('listing')) return 'IPO'
  if (h.includes('exits') || h.includes('sells stake') || h.includes('divests')) return 'EXIT'
  return 'DEAL'
}

// ── Market Tempo Gauge ────────────────────────────────────────────────────────

function MarketTempoGauge({ score, accent = '#7CB518' }: { score: number; accent?: string }) {
  const W = 180, H = 100
  const cx = W / 2, cy = H + 8, r = W / 2 - 8
  const pct = Math.max(0, Math.min(1, score / 100))
  const aN = Math.PI + (0 - Math.PI) * pct
  const nx = cx + r * Math.cos(aN), ny = cy + r * Math.sin(aN)

  const ticks = Array.from({ length: 11 }).map((_, i) => {
    const a = Math.PI + (0 - Math.PI) * (i / 10)
    const r1 = r - 2, r2 = r - (i % 5 === 0 ? 14 : 8)
    return { x1: cx + r1 * Math.cos(a), y1: cy + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a), strong: i % 5 === 0 }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={W} height={H + 12} viewBox={`0 0 ${W} ${H + 12}`} style={{ display: 'block' }}>
        <path d={`M 8 ${H + 8} A ${r} ${r} 0 0 1 ${W - 8} ${H + 8}`} fill="none" stroke="rgba(43,37,32,.12)" strokeWidth="8" strokeLinecap="round" />
        <path d={`M 8 ${H + 8} A ${r} ${r} 0 0 1 ${nx} ${ny}`} fill="none" stroke={accent} strokeWidth="8" strokeLinecap="round" />
        {ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.strong ? 'rgba(43,37,32,.45)' : 'rgba(43,37,32,.2)'} strokeWidth={t.strong ? 1.5 : 1} />)}
        <circle cx={nx} cy={ny} r={10} fill="#FAF8F3" stroke={accent} strokeWidth="3" />
        <circle cx={nx} cy={ny} r={4} fill={accent} />
        <text x={cx} y={H - 8} textAnchor="middle" fontFamily="var(--font-serif, 'Young Serif', Georgia, serif)" fontSize="32" fontWeight="400" fill="var(--ink)">{score}</text>
      </svg>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginTop: -4 }}>MARKET TEMPO</div>
    </div>
  )
}

// ── Signal Card ───────────────────────────────────────────────────────────────

const STATE_META: Record<string, { color: string; bg: string; label: string; blurb: string }> = {
  'EARLY SIGNAL': { color: '#7CB518', bg: 'rgba(163,230,53,.18)', label: 'EARLY SIGNAL', blurb: 'Capital is forming faster than narrative.' },
  'CONSENSUS':    { color: '#A88B4C', bg: 'rgba(168,139,76,.16)', label: 'CONSENSUS',    blurb: 'Deals and coverage are moving in step.' },
  'HYPE':         { color: '#B83A26', bg: 'rgba(184,58,38,.12)', label: 'HYPE',          blurb: 'Coverage is outrunning capital deployment.' },
  'QUIET':        { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'QUIET',       blurb: 'Low activity across most tracked themes.' },
}

function SignalCard({ state, tempo, isMobile }: { state: string; tempo: number; isMobile: boolean }) {
  const meta = STATE_META[state] || STATE_META['QUIET']
  return (
    <div className="paper" style={{ padding: isMobile ? '18px 16px' : '22px 26px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: isMobile ? 16 : 32, alignItems: 'center' }}>
      <div className="pin" style={{ top: 10, left: 14 }} />
      <div className="pin brass" style={{ top: 10, right: 14 }} />
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 999, background: meta.bg, marginBottom: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: '.16em', color: meta.color, fontWeight: 600 }}>
            TODAY · {meta.label}
          </span>
        </div>
        <div className="serif" style={{ fontSize: isMobile ? 22 : 28, lineHeight: 1.2, color: 'var(--ink)' }}>{meta.blurb}</div>
      </div>
      {/* Show gauge inline on desktop, below text on mobile */}
      <div style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'center' }}>
        <MarketTempoGauge score={tempo} accent={meta.color} />
      </div>
    </div>
  )
}

// ── Stats Row ─────────────────────────────────────────────────────────────────

function StatsRow({ dealCount, sectorCount, gainCount, quietCount, isMobile }: { dealCount: number; sectorCount: number; gainCount: number; quietCount: number; isMobile: boolean }) {
  const tiles = [
    { label: 'CONFIRMED TRANSACTIONS', value: dealCount, sub: 'in today\'s brief' },
    { label: 'SECTORS TRACKED',        value: sectorCount, sub: 'active deal flow' },
    { label: 'GAINING MOMENTUM',       value: gainCount, sub: 'accelerating themes' },
    { label: 'QUIET SECTORS',          value: quietCount, sub: '<1 deal · 30d' },
  ]
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
      background: 'var(--paper)',
      border: '1px solid rgba(43,37,32,.10)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {tiles.map((t, i) => (
        <div key={i} style={{
          padding: isMobile ? '14px 14px' : '18px 20px',
          borderRight: isMobile
            ? (i % 2 === 0 ? '1px solid rgba(43,37,32,.10)' : 'none')
            : (i < tiles.length - 1 ? '1px solid rgba(43,37,32,.10)' : 'none'),
          borderBottom: isMobile && i < 2 ? '1px solid rgba(43,37,32,.10)' : 'none',
        }}>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 8, letterSpacing: '.14em', color: 'var(--ink-mute)', marginBottom: 6 }}>{t.label}</div>
          <div className="num" style={{ fontSize: isMobile ? 36 : 44, lineHeight: 1, color: '#B83A26' }}>{t.value}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}>{t.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Deal Item ─────────────────────────────────────────────────────────────────

function DealItem({ index, headline, url, body }: { index: number; headline: string; url: string; body: string }) {
  const domain = getDomain(url)
  const type = getDealType(headline)

  return (
    <div style={{ padding: '20px 0', borderTop: '1px solid rgba(43,37,32,.12)' }}>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', display: 'block', marginBottom: 10 }}>
        № {String(index).padStart(2, '0')} · {type}
      </span>
      {/* Paragraph prose — full snapshot text */}
      <p style={{ margin: '0 0 12px', fontSize: '1rem', lineHeight: 1.85, color: 'var(--ink-soft)', fontFamily: `var(--font-sans, 'Instrument Sans', sans-serif)` }}>
        {renderInline(headline)}
      </p>
      {/* Read More — always visible */}
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent-deep)', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.06em', borderBottom: '1px solid rgba(124,181,24,.4)', paddingBottom: 1 }}>
        Read more at {domain} ↗
      </a>
      {body && (
        <p style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: 1.8, color: 'var(--ink-mute)' }}>{body}</p>
      )}
    </div>
  )
}

// ── Today's Movers ─────────────────────────────────────────────────────────────

function computeAccel(c30: number, c90: number) {
  return Math.round((c30 / 30 / Math.max((c90 - c30) / 60, 0.01) - 1) * 100)
}

function getMoverState(accel: number) {
  if (accel >= 30) return 'EARLY SIGNAL'
  if (accel >= 5) return 'CONSENSUS'
  if (accel >= -10) return 'ESTABLISHED'
  return 'COOLING'
}

const MOVER_COLORS: Record<string, { color: string; text: string }> = {
  'EARLY SIGNAL': { color: '#7CB518', text: '#4a6b1a' },
  'CONSENSUS':    { color: '#A88B4C', text: '#A88B4C' },
  'ESTABLISHED':  { color: '#8C7E6F', text: '#8C7E6F' },
  'COOLING':      { color: '#B83A26', text: '#B83A26' },
}

function TodaysMover({ sector, accel }: { sector: string; accel: number }) {
  const state = getMoverState(accel)
  const { text } = MOVER_COLORS[state] || MOVER_COLORS['ESTABLISHED']
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.5)', border: '1px solid rgba(43,37,32,.10)', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ font: '500 14px Instrument Sans', color: 'var(--ink)', marginBottom: 3 }}>{sector}</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, letterSpacing: '.14em', color: text }}>{state}</div>
        </div>
        <div className="num" style={{ fontSize: 22, color: accel >= 0 ? '#7CB518' : '#B83A26', lineHeight: 1 }}>
          {accel >= 0 ? '+' : ''}{accel}%
        </div>
      </div>
    </div>
  )
}

// ── Subscribe Form ────────────────────────────────────────────────────────────

function SubscribeForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'exists' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      const data = await res.json()
      setStatus(data.message === 'already_subscribed' ? 'exists' : data.message === 'subscribed' ? 'done' : 'error')
    } catch { setStatus('error') }
  }

  return (
    <div style={{ background: '#2B2520', borderRadius: 12, padding: '22px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, letterSpacing: '.2em', color: 'rgba(255,255,255,.45)', marginBottom: 10 }}>SUBSCRIBE</div>
      <div className="serif" style={{ fontSize: 19, lineHeight: 1.25, color: 'rgba(255,255,255,.9)', marginBottom: 14 }}>The Brief in your inbox, every market morning.</div>
      {status === 'done' ? (
        <p style={{ fontSize: 13, color: '#A3E635', fontFamily: 'Instrument Sans' }}>You&apos;re in. See you tomorrow.</p>
      ) : status === 'exists' ? (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', fontFamily: 'Instrument Sans' }}>Already subscribed.</p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@firm.com" required
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.85)', fontSize: 13, outline: 'none', fontFamily: 'Instrument Sans' }} />
          <button type="submit" disabled={status === 'loading' || !email.trim()}
            style={{ padding: '10px 16px', borderRadius: 8, border: 0, background: '#A3E635', color: '#1a1a1a', font: '600 13px Instrument Sans', cursor: 'default', flexShrink: 0, opacity: status === 'loading' ? .6 : 1 }}>
            Join
          </button>
        </form>
      )}
      {status === 'error' && <p style={{ fontSize: 11, color: '#E8892A', marginTop: 6 }}>Something went wrong — try again.</p>}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[88, 72, 96, 80, 60, 90, 68, 84, 76, 95].map((w, i) => (
        <div key={i} className="shimmer" style={{ height: 14, width: `${w}%`, borderRadius: 4, background: 'rgba(43,37,32,.10)' }} />
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const router = useRouter()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loading, setLoading] = useState(true)
  const [topSectors, setTopSectors] = useState<SectorData[]>([])
  const [underrated, setUnderrated] = useState<UnderratedData[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    fetch('/api/brief/latest').then(r => r.json()).then(d => { setBrief(d); setLoading(false) }).catch(() => setLoading(false))
    fetch('/api/top-sectors').then(r => r.json()).then(d => setTopSectors(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/underrated-sectors').then(r => r.json()).then(d => setUnderrated(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const blocks = brief ? parseContent(brief.content) : []
  const deals = blocks.filter((b): b is Extract<Block, { type: 'deal' }> => b.type === 'deal')

  const topMomentum = underrated[0]?.momentum ?? 1
  const marketState = topMomentum >= 2 ? 'EARLY SIGNAL' : topSectors[0] && computeAccel(topSectors[0].count_30d, topSectors[0].count_90d) > 15 ? 'CONSENSUS' : 'QUIET'
  const tempoScore = Math.min(95, Math.round(20 + (topSectors[0]?.count_30d || 0) * 2.5 + (underrated.length * 8)))

  const issueDate = brief?.date ? new Date(brief.date + 'T12:00:00') : new Date()
  const dayOfYear = Math.floor((issueDate.getTime() - new Date(issueDate.getFullYear(), 0, 0).getTime()) / 86400000)
  const vol = Math.floor(dayOfYear / 90) + 1
  const no = (dayOfYear % 90) + 1
  const dayName = issueDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const dateStr = issueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/(\d+)\s+(\w+)\s+(\d+)/, '$1 $2 $3')

  const movers: { sector: string; accel: number }[] = [
    ...topSectors.slice(0, 3).map(s => ({ sector: s.sector, accel: computeAccel(s.count_30d, s.count_90d) })),
    ...underrated.filter(u => !topSectors.slice(0, 3).some(s => s.sector === u.sector)).map(u => ({ sector: u.sector, accel: Math.round((u.momentum - 1) * 100) })),
  ].slice(0, 5)

  const px = isMobile ? '16px' : '28px'
  const maxW = 1160

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
      {/* Nav bar */}
      <div style={{ maxWidth: maxW, margin: '0 auto', padding: `16px ${px} 0` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.push('/')} style={{ appearance: 'none', border: 0, background: 'transparent', padding: 0, cursor: 'default', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            <span className="serif" style={{ fontSize: '1.35rem', color: 'var(--ink)', lineHeight: 1 }}>
              Premia<span style={{ color: 'var(--terra)', fontSize: '0.6em', verticalAlign: 'super', marginLeft: 1 }}>·</span>
            </span>
          </button>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, letterSpacing: '.1em', color: 'var(--ink-mute)' }}>
            {!isMobile && `Vol. ${vol} / `}No. {String(no).padStart(3, '0')}
          </span>
        </div>
      </div>

      {/* Masthead */}
      <div style={{ maxWidth: maxW, margin: '0 auto', padding: `18px ${px}` }}>
        <div style={{ height: 1, background: 'rgba(43,37,32,.2)', marginBottom: 16 }} />
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-mute)', marginBottom: 10 }}>THE PREMIA DESK</div>
          <h1 className="serif" style={{ fontSize: isMobile ? 'clamp(38px, 10vw, 56px)' : 'clamp(56px, 8vw, 96px)', fontWeight: 400, lineHeight: 1, margin: 0, color: 'var(--ink)', letterSpacing: '-0.03em' }}>Intelligence Brief</h1>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: isMobile ? 11 : 12, letterSpacing: '.14em', color: 'var(--ink-mute)', marginTop: 12 }}>
            {dayName} · {dateStr}
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(43,37,32,.2)' }} />
      </div>

      {/* Main content */}
      <div style={{ maxWidth: maxW, margin: '0 auto', padding: `0 ${px} 60px` }}>
        {loading ? (
          <div style={{ paddingTop: 24 }}><Skeleton /></div>
        ) : !brief ? (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div className="serif" style={{ fontSize: '1.6rem', color: 'var(--ink-mute)', marginBottom: 10 }}>No brief today — yet.</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-mute)' }}>The Intelligence Brief publishes every morning at 9 AM IST.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Signal card + Stats */}
            <SignalCard state={marketState} tempo={tempoScore} isMobile={isMobile} />
            <StatsRow
              dealCount={deals.length}
              sectorCount={topSectors.length}
              gainCount={underrated.length}
              quietCount={Math.max(0, 12 - topSectors.length - underrated.length)}
              isMobile={isMobile}
            />

            {/* Body: single column on mobile, two-column on desktop */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 260px', gap: isMobile ? 24 : 28, alignItems: 'start' }}>

              {/* LEFT: Full brief in document order */}
              <div>
                {(() => {
                  let dealIdx = 0
                  let firstPara = true
                  return blocks.map((block, i) => {
                    if (block.type === 'section') {
                      return (
                        <div key={i} style={{ margin: '36px 0 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                            <div style={{ width: 28, height: 2, background: 'var(--terra)', borderRadius: 2, flexShrink: 0 }} />
                            <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.12)' }} />
                          </div>
                          <h2 className="serif" style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: 'var(--ink)', letterSpacing: '-.01em' }}>{block.text}</h2>
                        </div>
                      )
                    }
                    if (block.type === 'deal') {
                      dealIdx++
                      return <DealItem key={i} index={dealIdx} headline={block.headline} url={block.url} body={block.body} />
                    }
                    if (block.type === 'para') {
                      const isFirst = firstPara
                      if (firstPara) firstPara = false
                      return (
                        <p key={i} style={{
                          fontFamily: `var(--font-sans, 'Instrument Sans', sans-serif)`,
                          fontSize: isMobile ? '1rem' : '1.06rem',
                          lineHeight: 1.85,
                          color: 'var(--ink-soft)',
                          margin: '0 0 18px',
                        }}>
                          {isFirst && (
                            <span className="serif" style={{ float: 'left', fontSize: isMobile ? '3rem' : '3.8rem', lineHeight: .8, marginRight: 8, marginTop: 6, color: '#B83A26', fontWeight: 400 }}>
                              {block.text[0]}
                            </span>
                          )}
                          {isFirst ? block.text.slice(1) : renderInline(block.text)}
                        </p>
                      )
                    }
                    return null
                  })
                })()}
              </div>

              {/* RIGHT: Sidebar — rendered below on mobile */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {movers.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                      <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.12)' }} />
                      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', fontWeight: 600, whiteSpace: 'nowrap' }}>TODAY&apos;S MOVERS</span>
                      <div style={{ flex: 1, height: 1, background: 'rgba(43,37,32,.12)' }} />
                    </div>
                    {/* On mobile: 2-column grid for movers */}
                    {isMobile ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {movers.map((m, i) => <TodaysMover key={i} sector={m.sector} accel={m.accel} />)}
                      </div>
                    ) : (
                      movers.map((m, i) => <TodaysMover key={i} sector={m.sector} accel={m.accel} />)
                    )}
                  </div>
                )}

                <SubscribeForm />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
