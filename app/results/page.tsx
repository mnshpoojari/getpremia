'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import MarketContextPanel from '@/components/MarketContextPanel'
import type { MarketContextResult } from '@/lib/queries/marketContext'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase-client'

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

interface AnalyseResult {
  low_data_mode: boolean
  consensus: { state: string; colour: string; explanation: string }
  signal_assessment?: {
    verdict: string
    badge: string
    confidence: number
    displayNote: string | null
    showRawVerdict: boolean
  }
  chart_data: { month: string; deal_count: number }[]
  stats: {
    count_30d: number
    count_90d: number
    media_sources: number
    media_30d: number
    source_count?: number
    data_volume?: number
    distinct_deal_source_count?: number
    distinct_narrative_source_count?: number
    feed_health_summary?: {
      feed_url: string
      consecutive_failures: number
      region: string | null
      sector: string | null
      feed_role: string | null
    }[]
    velocity_ratio: number
    signal_gap: number
    confidence: 'high' | 'medium' | 'low'
  }
  premia_score?: number
  deal_momentum?: number
  narrative_velocity_score?: number
  signal_strength?: 'Weak' | 'Moderate' | 'Dense'
  why_bullets?: string[]
  buyer_composition?: Record<string, number>
  buyer_counts?: Record<string, number>
  buyer_sample_count?: number
  three_things?: string[]
  scenario_triggers?: { event: string; likelyImpact: string }[]
  premia_read: string
  thematic_stage: { stage: string; meaning: string }
  narrative_velocity: { ratio: number; label: string; description: string }
  thesis: string
  evidence: { title: string; url: string; published_date: string; source: string; isTranslated?: boolean }[]
  market_context: MarketContextResult | null
}

const STATE_META: Record<string, { color: string; bg: string; label: string; blurb: string }> = {
  'INSUFFICIENT DATA': { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'Insufficient Data',
    blurb: 'Source coverage is too thin to make a reliable market call yet.' },
  'EARLY SIGNAL': { color: '#7CB518', bg: 'rgba(163,230,53,.18)', label: 'Early Signal',
    blurb: "Recent activity is outpacing media. The narrative hasn't formed yet — you're ahead of the page." },
  'CONSENSUS':    { color: '#A88B4C', bg: 'rgba(168,139,76,.16)', label: 'Crowded',
    blurb: 'Deals and coverage in lockstep. The theme is well-formed; most participants already see it.' },
  'HYPE':         { color: '#B83A26', bg: 'rgba(184,58,38,.12)', label: 'Hype',
    blurb: 'Coverage is running ahead of capital. Narrative without follow-through — proceed with skepticism.' },
  'QUIET':        { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'Quiet',
    blurb: 'Little of either. Either too early to call, or simply not a real theme yet.' },
  'ACTIVE':       { color: '#A88B4C', bg: 'rgba(168,139,76,.16)', label: 'Active',
    blurb: 'Strong, sustained deal activity in a well-established theme. Capital is actively deploying.' },
  'ESTABLISHED':  { color: '#7CB518', bg: 'rgba(163,230,53,.18)', label: 'Established',
    blurb: 'A mature market with consistent recent activity. Opportunity is in differentiation, not discovery.' },
  'NARRATIVE':    { color: '#B83A26', bg: 'rgba(184,58,38,.12)', label: 'Narrative',
    blurb: 'Media coverage outpacing recent activity in a mature sector. Stories are getting ahead of reality.' },
  'COOLING':      { color: '#8C7E6F', bg: 'rgba(140,126,111,.14)', label: 'Cooling',
    blurb: 'Activity is slowing. The theme had its run; deploy selectively if at all.' },
}

// Renders a very small subset of markdown that the synthesis LLM tends to emit:
// **bold** spans, and lines starting with "* " as bullet items. Anything else
// is left as plain text. This avoids pulling in a full markdown parser for
// what is, in practice, a narrow and predictable output shape.
function renderInlineBold(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyPrefix}-t${i}`}>{part}</span>
  })
}

function renderMarkdownParagraph(text: string, keyPrefix: string, paragraphStyle: CSSProperties) {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  const isBulletBlock = lines.length > 1 && lines.every(l => l.trim().startsWith('* '))

  if (isBulletBlock) {
    return (
      <ul key={keyPrefix} style={{ margin: '0 0 14px', paddingLeft: 20 }}>
        {lines.map((line, i) => (
          <li key={`${keyPrefix}-li${i}`} style={{ ...paragraphStyle, margin: '0 0 6px' }}>
            {renderInlineBold(line.trim().replace(/^\*\s+/, ''), `${keyPrefix}-${i}`)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <p key={keyPrefix} style={paragraphStyle}>
      {renderInlineBold(text, keyPrefix)}
    </p>
  )
}

const LOADING_MSGS = [
  'Reading between the lines of press releases…',
  'Following the money…',
  'Cross-referencing deal rumours with actual facts…',
  'Checking what the smart money is doing…',
  'Separating signal from noise…',
  'Triangulating from 40+ sources…',
  'Looking past the headline valuation…',
]

// ── Skeleton components ───────────────────────────────────────────────────────

const SH = { background: 'rgba(43,37,32,.08)', borderRadius: 4 } as const

function SkeletonVerdict({ isMobile }: { isMobile: boolean }) {
  return (
    <section style={{ background: 'rgba(43,37,32,.04)', border: '1px solid rgba(43,37,32,.08)', borderRadius: 14, padding: isMobile ? '18px 20px' : '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div className="shimmer" style={{ ...SH, width: 12, height: 12, borderRadius: '50%' }} />
        <div className="shimmer" style={{ ...SH, width: 160, height: 26 }} />
      </div>
      <div className="shimmer" style={{ ...SH, width: '78%', height: 13, marginBottom: 7 }} />
      <div className="shimmer" style={{ ...SH, width: '55%', height: 13, marginBottom: 22 }} />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', background: 'rgba(255,255,255,.3)', border: '1px solid rgba(43,37,32,.07)', borderRadius: 12 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            padding: isMobile ? '12px 14px' : '14px 18px',
            borderRight: isMobile ? (i%2===0 ? '1px dashed rgba(43,37,32,.10)' : 'none') : (i<3 ? '1px dashed rgba(43,37,32,.10)' : 'none'),
            borderBottom: isMobile && i<2 ? '1px dashed rgba(43,37,32,.10)' : 'none',
          }}>
            <div className="shimmer" style={{ ...SH, width: 56, height: 9, marginBottom: 9 }} />
            <div className="shimmer" style={{ ...SH, width: 44, height: isMobile ? 24 : 30, marginBottom: 7 }} />
            <div className="shimmer" style={{ ...SH, width: 72, height: 9 }} />
          </div>
        ))}
      </div>
      <div className="shimmer" style={{ ...SH, width: '88%', height: 12, marginTop: 16 }} />
    </section>
  )
}

function SkeletonPremiaRead() {
  return (
    <section style={{ background: 'rgba(43,37,32,.04)', border: '1px solid rgba(43,37,32,.08)', borderLeft: '3px solid rgba(43,37,32,.14)', borderRadius: 12, padding: '20px 24px' }}>
      <div className="shimmer" style={{ ...SH, width: 96, height: 9, marginBottom: 14 }} />
      <div className="shimmer" style={{ ...SH, width: '96%', height: 14, marginBottom: 9 }} />
      <div className="shimmer" style={{ ...SH, width: '88%', height: 14, marginBottom: 9 }} />
      <div className="shimmer" style={{ ...SH, width: '65%', height: 14 }} />
    </section>
  )
}

function SkeletonChart({ isMobile }: { isMobile: boolean }) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 16 }}>
      <div className="paper" style={{ padding: '20px 22px' }}>
        <div className="shimmer" style={{ ...SH, width: 130, height: 9, marginBottom: 8 }} />
        <div className="shimmer" style={{ ...SH, width: 110, height: 17, marginBottom: 18 }} />
        <div style={{ position: 'relative', height: 190, borderRadius: 8, overflow: 'hidden', background: 'rgba(43,37,32,.04)' }}>
          <div className="shimmer" style={{ position: 'absolute', inset: 0, background: 'rgba(43,37,32,.05)' }} />
          {[0.25, 0.5, 0.75].map((y, i) => (
            <div key={i} style={{ position: 'absolute', left: 36, right: 0, top: `${y * 100}%`, height: 1, background: 'rgba(43,37,32,.07)' }} />
          ))}
        </div>
        <div className="shimmer" style={{ ...SH, width: '70%', height: 10, marginTop: 10 }} />
      </div>
      <div className="paper" style={{ padding: '18px 20px' }}>
        <div className="shimmer" style={{ ...SH, width: 100, height: 9, marginBottom: 8 }} />
        <div className="shimmer" style={{ ...SH, width: 120, height: 20, marginBottom: 8 }} />
        <div className="shimmer" style={{ ...SH, width: '85%', height: 11, marginBottom: 18 }} />
        {[0,1,2,3].map(i => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 36px', gap: 10, padding: '9px 0', borderBottom: '1px dashed rgba(43,37,32,.08)' }}>
            <div className="shimmer" style={{ ...SH, height: 7 }} />
            <div className="shimmer" style={{ ...SH, height: 7 }} />
            <div className="shimmer" style={{ ...SH, height: 7 }} />
          </div>
        ))}
      </div>
    </section>
  )
}

function SkeletonNarrative() {
  return (
    <section className="paper" style={{ padding: '22px 26px' }}>
      <div className="shimmer" style={{ ...SH, width: 120, height: 9, marginBottom: 14 }} />
      <div style={{ borderLeft: '2px solid rgba(43,37,32,.08)', paddingLeft: 18 }}>
        {[100, 92, 98, 75, 100, 88, 60].map((w, i) => (
          <div key={i} className="shimmer" style={{ ...SH, width: `${w}%`, height: 13, marginBottom: 9 }} />
        ))}
      </div>
    </section>
  )
}

function SkeletonEvidence() {
  return (
    <section>
      <div className="shimmer" style={{ ...SH, width: 160, height: 9, marginBottom: 6 }} />
      <div className="shimmer" style={{ ...SH, width: 220, height: 19, marginBottom: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ background: '#FAF8F3', border: '1px solid rgba(43,37,32,.10)', borderRadius: 12, padding: '14px 18px' }}>
            <div className="shimmer" style={{ ...SH, width: `${[78,65,82][i]}%`, height: 13, marginBottom: 9 }} />
            <div style={{ display: 'flex', gap: 14 }}>
              <div className="shimmer" style={{ ...SH, width: 90, height: 9 }} />
              <div className="shimmer" style={{ ...SH, width: 66, height: 9 }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── MiniLineChart ─────────────────────────────────────────────────────────────

function MiniLineChart({ data }: { data: { month: string; deal_count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 560, H = 190
  const PAD = { l: 36, r: 12, t: 14, b: 30 }
  const w = W - PAD.l - PAD.r
  const h = H - PAD.t - PAD.b
  const n = data.length
  if (n === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>No chart data available.</div>

  const counts = data.map(d => d.deal_count)
  const months = data.map(d => d.month)
  const yMax = Math.max(Math.ceil(Math.max(...counts) / 5) * 5, 5)

  const X = (i: number) => PAD.l + (w * (n <= 1 ? 0.5 : i / (n - 1)))
  const Y = (v: number) => PAD.t + h - (v / yMax) * h

  let pathD = `M ${X(0)} ${Y(counts[0])}`
  for (let i = 1; i < n; i++) {
    const cx = (X(i - 1) + X(i)) / 2
    pathD += ` C ${cx} ${Y(counts[i - 1])}, ${cx} ${Y(counts[i])}, ${X(i)} ${Y(counts[i])}`
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const k = Math.max(0, Math.min(1, (e.clientX - r.left - PAD.l) / w))
    setHover(Math.round(k * (n - 1)))
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(yMax * t))

  return (
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
      onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)}
      style={{ display: 'block', cursor: 'crosshair' }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="rgba(43,37,32,.08)" strokeDasharray="3 4" />
          <text x={PAD.l - 6} y={Y(v) + 4} textAnchor="end" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="rgba(43,37,32,.42)">{v}</text>
        </g>
      ))}
      {months.map((m, i) => {
        if (n > 6 && i % 2 !== 0 && i !== n - 1) return null
        return <text key={i} x={X(i)} y={H - 8} textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="rgba(43,37,32,.42)">{m.split(' ')[0]}</text>
      })}
      <path d={`${pathD} L ${X(n - 1)} ${Y(0)} L ${X(0)} ${Y(0)} Z`} fill="rgba(184,58,38,.10)" />
      <path d={pathD} stroke="#B83A26" strokeWidth="2.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {counts.map((v, i) => (
        <circle key={i} cx={X(i)} cy={Y(v)} r={hover === i ? 5 : 3} fill="#FAF8F3" stroke="#B83A26" strokeWidth="1.8" />
      ))}
      {hover !== null && (
        <g>
          <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(43,37,32,.35)" strokeDasharray="2 3" />
          <rect x={Math.min(X(hover) - 52, W - 118)} y={PAD.t - 2} width="114" height="18" rx="4" fill="#2B2520" />
          <text x={Math.min(X(hover), W - 59)} y={PAD.t + 12} textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" fill="#E9E1CF">
            {months[hover]} · {counts[hover]} items
          </text>
        </g>
      )}
    </svg>
  )
}

// ── Results Content ───────────────────────────────────────────────────────────

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => part.startsWith('**') && part.endsWith('**')
        ? <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
      )}
    </>
  )
}

function titleFromSection(raw: string) {
  const cleaned = raw
    .replace(/^#+\s*/, '')
    .replace(/^SECTION\s+\d+\s*[—-]\s*/i, '')
    .replace(/[_*`]/g, '')
    .trim()
  if (!cleaned) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
}

function parseMarkdownSections(markdown: string) {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const sections: { heading: string; body: string[] }[] = []
  let current: { heading: string; body: string[] } | null = null

  for (const block of blocks) {
    const isHeading = block.split('\n').length === 1 &&
      /^(?:#+\s*)?(?:SECTION\s+\d+\s*[—-]\s*)?[A-Z][A-Z0-9 &/()[\]:'.,—-]{2,}$/.test(block) &&
      !block.startsWith('* ')
    if (isHeading) {
      if (current && current.body.length > 0) sections.push(current)
      current = { heading: titleFromSection(block), body: [] }
      continue
    }
    if (!current) current = { heading: sections.length === 0 ? 'The sector' : 'What the data says', body: [] }
    current.body.push(block)
  }

  if (current && current.body.length > 0) sections.push(current)
  return sections
}

function MarkdownSectionBody({ blocks }: { blocks: string[] }) {
  return (
    <div style={{ borderLeft: '2px solid rgba(43,37,32,.18)', paddingLeft: 18 }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
        const isList = lines.length > 0 && lines.every(line => /^[-*]\s+/.test(line))
        if (isList) {
          return (
            <ul key={i} style={{ margin: '0 0 14px 18px', padding: 0, color: 'var(--ink)' }}>
              {lines.map((line, idx) => (
                <li key={idx} style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 5 }}>
                  <InlineMarkdown text={line.replace(/^[-*]\s+/, '')} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} style={{ fontSize: 15, lineHeight: 1.7, margin: '0 0 14px', fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)", fontWeight: 400, color: 'var(--ink)' }}>
            <InlineMarkdown text={block} />
          </p>
        )
      })}
    </div>
  )
}

function ResultsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const thesis = searchParams.get('thesis') ?? ''
  const [data, setData] = useState<AnalyseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msgIdx, setMsgIdx] = useState(0)
  const [msgKey, setMsgKey] = useState(0)
  const [revealed, setRevealed] = useState({ verdict: false, premiaRead: false, chart: false, market: false, narrative: false, evidence: false })
  const [pinPressed, setPinPressed] = useState(false)
  const [pinned,     setPinned]     = useState(false)

  useEffect(() => {
    if (!thesis) { router.push('/app'); return }
    setMsgIdx(Math.floor(Math.random() * LOADING_MSGS.length))
    const timer = setInterval(() => {
      setMsgIdx(i => (i + 1) % LOADING_MSGS.length)
      setMsgKey(k => k + 1)
    }, 1500)
    fetch('/api/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thesis }) })
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
        clearInterval(timer)
        setRevealed(r => ({ ...r, verdict: true }))
        setTimeout(() => setRevealed(r => ({ ...r, premiaRead: true })), 200)
        setTimeout(() => setRevealed(r => ({ ...r, chart: true })), 420)
        setTimeout(() => setRevealed(r => ({ ...r, market: true })), 760)
        setTimeout(() => setRevealed(r => ({ ...r, narrative: true })), 1100)
        setTimeout(() => setRevealed(r => ({ ...r, evidence: true })), 1440)
      })
      .catch(e => { setError(e instanceof Error ? e.message : 'Unknown error'); setLoading(false); clearInterval(timer) })
    return () => clearInterval(timer)
  }, [thesis, router])

  const handlePin = async () => {
    if (!data) return
    const note = {
      id: crypto.randomUUID(), text: thesis, state: data.consensus.state,
      x: 20, y: 30,
      tilt: (Math.random() - 0.5) * 6,
      deals30: data.stats.count_30d, deals90: data.stats.count_90d, media: data.stats.media_sources,
    }
    if (user) {
      await supabase.from('user_pins').insert({ ...note, user_id: user.id })
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('premia-pad-notes') || '[]')
        const positioned = { ...note, x: 20 + (saved.length % 4) * 210, y: 30 + Math.floor(saved.length / 4) * 140 }
        localStorage.setItem('premia-pad-notes', JSON.stringify([...saved, positioned]))
      } catch (_) {}
    }
    setPinned(true)
    setTimeout(() => setPinned(false), 2200)
  }

  const assessment = data?.signal_assessment
  const displayState = assessment?.showRawVerdict === false ? assessment.verdict : data?.consensus.state
  const meta = displayState ? (STATE_META[displayState] ?? STATE_META['QUIET']) : null
  const confColor = !assessment ? '#8C7E6F' : assessment.confidence >= 0.8 ? '#7CB518' : assessment.confidence >= 0.6 ? '#A88B4C' : '#8C7E6F'
  const confLabel = assessment?.badge ?? ''
  const isLowConfidence = (assessment?.confidence ?? 1) < 0.3
  const confSub = assessment?.displayNote ?? (
    !data ? '' : assessment?.confidence && assessment.confidence >= 0.8
      ? 'Broad dataset with clear signal alignment.'
      : 'Moderate confidence based on source breadth, data volume, and clarity.'
  )
  const canShareAnalysis = assessment?.showRawVerdict !== false
  const sourceCount = data?.stats.source_count ?? data?.stats.media_sources ?? 0
  const dataVolume = data?.stats.data_volume ?? data?.stats.count_90d ?? 0
  const buyerSampleCount = data?.buyer_sample_count ?? data?.stats.count_90d ?? 0
  const showRawCounts = buyerSampleCount < 10
  const confBars = data ? [
    { label: 'Data volume',    pct: Math.min(95, 30 + dataVolume * 2) },
    { label: 'Recency',        pct: Math.min(95, 40 + data.stats.count_30d * 3) },
    { label: 'Source breadth', pct: Math.min(95, 40 + sourceCount * 4) },
    { label: 'Signal clarity', pct: Math.max(10, Math.min(95, 80 - Math.abs(data.stats.signal_gap) * 4)) },
  ] : []
  const mcCallout = (() => {
    if (!data?.low_data_mode || !data?.market_context) return null
    const mc = data.market_context
    const parts: string[] = []
    if (mc.market_size.value != null) {
      const val = mc.market_size.value
      parts.push(`$${val >= 1000 ? `${(val / 1000).toFixed(1)}T` : `${val.toFixed(0)}bn`} market`)
    }
    if (mc.cagr.value != null) parts.push(`${mc.cagr.value.toFixed(1)}% CAGR`)
    return parts.length > 0 ? parts.join(' · ') : null
  })()

  const v = data?.stats.velocity_ratio ?? 1
  const pct = Math.round(Math.abs(v - 1) * 100)
  const velLabel = v >= 1.5 ? `↑ ${pct}% vs prior` : v <= 0.7 ? `↓ ${pct}% vs prior` : '→ flat'
  const velColor = v >= 1.5 ? '#7CB518' : v <= 0.7 ? '#B83A26' : 'var(--ink-mute)'
  const displayVelLabel = data && data.stats.count_90d < 10
    ? `${data.stats.count_30d} of ${data.stats.count_90d} in last 30d`
    : velLabel
  const gap = data?.stats.signal_gap ?? 0

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
      {/* Print-safe pagination: keep each card whole instead of letting the
          browser's print/PDF engine slice text off mid-word at a page edge. */}
      <style jsx global>{`
        @media print {
          .paper, section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          a {
            text-decoration: none;
          }
        }
      `}</style>
      {/* Top nav */}
      <header style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(43,37,32,.08)' }}>
        <button onClick={() => router.push('/app')} style={{ appearance: 'none', border: 0, background: 'transparent', padding: 0, cursor: 'default', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          <span className="serif" style={{ fontSize: '1.4rem', color: 'var(--ink)', lineHeight: 1 }}>
            Premia<span style={{ color: 'var(--terra)', fontSize: '0.6em', verticalAlign: 'super', marginLeft: 1 }}>·</span>
          </span>
        </button>
        {data && (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <button
              onClick={handlePin}
              disabled={!canShareAnalysis}
              onPointerDown={() => setPinPressed(true)}
              onPointerUp={() => setPinPressed(false)}
              onPointerLeave={() => setPinPressed(false)}
              style={{
                appearance: 'none',
                border: canShareAnalysis ? '1px solid rgba(124,181,24,.55)' : '1px solid rgba(140,126,111,.35)',
                background: canShareAnalysis ? (pinPressed ? 'rgba(163,230,53,.32)' : 'rgba(163,230,53,.18)') : 'rgba(140,126,111,.10)',
                color: canShareAnalysis ? 'var(--ink)' : 'var(--ink-mute)',
                fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)",
                fontSize: 13,
                fontWeight: 700,
                padding: '7px 16px',
                borderRadius: 999,
                cursor: 'default',
                transform: canShareAnalysis && pinPressed ? 'scale(0.95) translateY(1px)' : 'scale(1) translateY(0)',
                boxShadow: !canShareAnalysis || pinPressed ? 'none' : '0 2px 6px -3px rgba(124,181,24,.5), 0 1px 0 rgba(255,255,255,.5) inset',
                transition: pinPressed ? 'transform .06s ease-out, box-shadow .06s ease-out' : 'all .15s ease',
              }}>
              {canShareAnalysis ? 'Pin to Pad' : 'Preliminary'}
            </button>
            <span style={{
              marginTop: 6,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.04em',
              color: '#7CB518',
              fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)",
              opacity: pinned ? 1 : 0,
              transform: pinned ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity .2s ease, transform .2s ease',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
              Pinned to Pad!
            </span>
          </div>
        )}
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>

        {/* Back crumb */}
        <button onClick={() => router.push('/app')} style={{ appearance: 'none', border: 0, background: 'transparent', color: 'var(--ink-mute)', font: '500 12px Instrument Sans', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 18, padding: 0 }}>
          ← Back to search
        </button>

        {/* Title — always visible immediately from URL param */}
        <h1 className="serif" style={{ fontSize: isMobile ? 26 : 34, lineHeight: 1.1, margin: '0 0 6px', letterSpacing: '-.01em', fontWeight: 400 }}>
          {thesis}
        </h1>

        {/* Subline — loading messages while fetching, real stats after */}
        <div style={{ margin: '0 0 24px', minHeight: 22, overflow: 'hidden' }}>
          {loading ? (
            <p key={msgKey} className="msg-in" style={{ margin: 0, fontSize: 13, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
              {LOADING_MSGS[msgIdx]}
            </p>
          ) : data ? (
            <p className="fade-up" style={{ margin: 0, fontSize: 14, color: 'var(--ink-mute)' }}>
              Based on {data.stats.count_90d} items tracked · {sourceCount} {sourceCount === 1 ? 'source' : 'sources'} · 90 days
            </p>
          ) : null}
        </div>

        {/* Error state */}
        {error && (
          <div style={{ background: 'rgba(184,58,38,.08)', border: '1px solid rgba(184,58,38,.3)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem' }}>
            <p style={{ color: '#B83A26', margin: 0 }}>Analysis failed: {error}</p>
          </div>
        )}

        {/* Content — skeleton immediately, sections fill in progressively */}
        {!error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* VERDICT + STATS */}
            {revealed.verdict && data && meta ? (
              <div className="fade-up">
                <section style={{ background: meta.bg, border: `1px solid ${meta.color}55`, borderRadius: 14, padding: isMobile ? '18px 20px' : '24px 28px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ backgroundImage: 'linear-gradient(to bottom, transparent calc(100% - 1px), rgba(43,37,32,.05) 100%)', backgroundSize: '100% 22px', position: 'absolute', inset: 0, pointerEvents: 'none' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: isMobile ? 12 : 24, alignItems: 'flex-start', position: 'relative' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: meta.color, boxShadow: `0 0 0 4px ${meta.color}25`, display: 'inline-block', flexShrink: 0 }} />
                        <span className="serif" style={{ fontSize: isMobile ? 24 : 28, color: meta.color }}>{meta.label}</span>
                      </div>
                      <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{meta.blurb}</p>
                    </div>
                    <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                      <span className="mono" style={{ display: 'inline-block', padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.55)', border: `1px solid ${confColor}55`, color: confColor, fontSize: 11, letterSpacing: '.1em', fontWeight: 600 }}>
                        {confLabel.toUpperCase()}
                      </span>
                        {data.premia_score !== undefined && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Confidence</div>
                            <div style={{ fontSize: 20, color: confColor, fontWeight: 700 }}>{data.premia_score}%</div>
                          </div>
                        )}
                      {!canShareAnalysis && (
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>Sparse data in this market may itself be signal.</div>
                      )}
                    </div>
                  </div>
                    {/* Compact quantitative layer beneath verdict */}
                    {data && (
                      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.55)', borderRadius: 10, border: '1px solid rgba(43,37,32,.06)' }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>PREMIA SCORE</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.premia_score ?? '—'}/100</div>
                        </div>
                        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.55)', borderRadius: 10, border: '1px solid rgba(43,37,32,.06)' }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>DEAL MOMENTUM</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: data.deal_momentum && data.deal_momentum >= 0 ? '#7CB518' : '#B83A26' }}>{data.deal_momentum && data.deal_momentum >= 0 ? `+${data.deal_momentum}%` : `${data.deal_momentum}%`}</div>
                        </div>
                        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.55)', borderRadius: 10, border: '1px solid rgba(43,37,32,.06)' }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>NARRATIVE VELOCITY</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.narrative_velocity_score ?? '—'}/100</div>
                        </div>
                        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.55)', borderRadius: 10, border: '1px solid rgba(43,37,32,.06)' }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>SIGNAL STRENGTH</div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{assessment?.badge ?? data.signal_strength}</div>
                        </div>
                      </div>
                    )}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', marginTop: 20, background: 'rgba(255,255,255,.45)', border: '1px solid rgba(43,37,32,.10)', borderRadius: 12 }}>
                    {[
                      { label: 'Deals · 30d',  value: data.stats.count_30d, sub: displayVelLabel, color: velColor },
                      { label: 'Deals · 90d',  value: data.stats.count_90d, sub: 'transactions tracked', color: 'var(--ink)' },
                      { label: 'Sources',       value: sourceCount, sub: 'independent sources', color: 'var(--ink)' },
                      { label: 'Signal gap',    value: gap > 0 ? `+${gap}` : String(gap), sub: gap >= 0 ? 'deals ahead of media' : 'media ahead of deals', color: gap >= 0 ? '#7CB518' : '#B83A26' },
                    ].map((t, i) => (
                      <div key={i} style={{
                        padding: isMobile ? '12px 14px' : '14px 18px',
                        borderRight: isMobile ? (i % 2 === 0 ? '1px dashed rgba(43,37,32,.16)' : 'none') : (i < 3 ? '1px dashed rgba(43,37,32,.16)' : 'none'),
                        borderBottom: isMobile && i < 2 ? '1px dashed rgba(43,37,32,.16)' : 'none',
                      }}>
                        <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)' }}>{t.label.toUpperCase()}</div>
                        <div className="num" style={{ fontSize: isMobile ? 26 : 32, lineHeight: 1.05, marginTop: 4, color: t.color }}>{t.value}</div>
                        <div style={{ fontSize: 11, marginTop: 2, color: 'var(--ink-mute)' }}>{t.sub}</div>
                      </div>
                    ))}
                  </div>
                  {/* Thematic stage tracker */}
                  {(() => {
                    const STAGES = ['Exploratory', 'Emerging', 'Consensus', 'Crowded', 'Exhausted'] as const
                    const activeIdx = isLowConfidence ? -1 : STAGES.indexOf(data.thematic_stage.stage as typeof STAGES[number])
                    return (
                      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed rgba(43,37,32,.14)' }}>
                        <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', marginBottom: 12 }}>THEMATIC STAGE</div>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start' }}>
                          <div style={{ position: 'absolute', top: 6, left: '6%', right: '6%', height: 1, background: 'rgba(43,37,32,.12)' }} />
                          {STAGES.map((stage, i) => {
                            const isActive = i === activeIdx
                            const isPast = i < activeIdx
                            return (
                              <div key={stage} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', zIndex: 1 }}>
                                <div style={{
                                  width: 13, height: 13, borderRadius: '50%',
                                  background: isLowConfidence ? 'rgba(43,37,32,.10)' : isActive ? meta.color : isPast ? `${meta.color}60` : 'rgba(43,37,32,.12)',
                                  boxShadow: !isLowConfidence && isActive ? `0 0 0 3px ${meta.color}28` : 'none',
                                  transition: 'background .3s, box-shadow .3s',
                                }} />
                                <span style={{
                                  fontSize: isMobile ? 9 : 10.5,
                                  color: !isLowConfidence && isActive ? meta.color : 'var(--ink-mute)',
                                  fontWeight: !isLowConfidence && isActive ? 700 : 400,
                                  fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)",
                                  textAlign: 'center',
                                  lineHeight: 1.2,
                                  letterSpacing: !isLowConfidence && isActive ? '.01em' : 0,
                                }}>{stage}</span>
                              </div>
                            )
                          })}
                        </div>
                        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.55, fontStyle: 'italic' }}>
                          {isLowConfidence ? 'Not enough data to place.' : data.thematic_stage.meaning}
                        </p>
                      </div>
                    )
                  })()}
                  {!isLowConfidence && (
                    <p style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, opacity: .8, margin: '14px 0 0' }}>
                      {data.consensus.explanation}
                    </p>
                  )}
                  {mcCallout && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,255,255,.45)', borderRadius: 8, border: '1px solid rgba(43,37,32,.10)', fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
                      Confirmed deal coverage is thin for this thesis — we couldn&apos;t capture enough transactions to draw conclusions. Sector benchmarks from research reports are available below.
                      <span style={{ color: 'var(--ink)', fontWeight: 500 }}> {mcCallout}.</span>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <SkeletonVerdict isMobile={isMobile} />
            )}

            {/* PREMIA READ */}
            {revealed.premiaRead && data && meta ? (
              <div className="fade-up">
                <section style={{
                  background: `${meta.color}0e`,
                  border: `1px solid ${meta.color}30`,
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: 12,
                  padding: isMobile ? '16px 18px' : '20px 26px',
                }}>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: meta.color, marginBottom: 12 }}>PREMIA READ</div>
                  <p style={{
                    margin: 0, fontSize: isMobile ? 14.5 : 15.5, lineHeight: 1.72,
                    color: 'var(--ink)',
                    fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)",
                    fontStyle: 'normal',
                  }}>
                    {data.premia_read}
                  </p>
                </section>
              </div>
            ) : (
              <SkeletonPremiaRead />
            )}

            {/* CHART + CONFIDENCE */}
            {revealed.chart && data ? (
              <div className="fade-up">
                <section style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 16 }}>
                  <div className="paper" style={{ padding: '20px 22px' }}>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginBottom: 4 }}>NEWS & DEAL ACTIVITY</div>
                    <div className="serif" style={{ fontSize: 18, marginBottom: 14 }}>Past 12 Months</div>
                    <MiniLineChart data={data.chart_data} />
                    <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8, marginBottom: 0 }}>
                      Hover the chart to scrub months. Data from 40+ tracked sources.
                    </p>
                  </div>
                  <div className="paper" style={{ padding: '18px 20px' }}>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginBottom: 6 }}>SIGNAL COVERAGE</div>
                    <div className="serif" style={{ fontSize: 22, color: confColor, lineHeight: 1, marginBottom: 6 }}>{confLabel}</div>
                    <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 14 }}>{confSub}</p>
                    {confBars.map(({ label, pct: barPct }) => {
                      const barColor = barPct >= 65 ? '#7CB518' : barPct >= 40 ? '#A88B4C' : '#B83A26'
                      return (
                        <div key={label} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 36px', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed rgba(43,37,32,.14)' }}>
                          <span title={label === 'Signal clarity' ? 'Measures whether activity clusters around a specific theme or is dispersed across unrelated sub-sectors.' : label === 'Source breadth' ? 'Measures how many independent sources are reporting activity.' : label === 'Data volume' ? 'Measures the amount of supporting transaction data.' : label === 'Recency' ? 'Measures how current the signal is.' : ''} style={{ font: '500 12px Instrument Sans', color: 'var(--ink-soft)', cursor: 'help' }}>{label}</span>
                          <div style={{ height: 7, background: 'rgba(43,37,32,.06)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${barPct}%`, background: `linear-gradient(90deg, ${barColor}55, ${barColor}cc)`, borderRadius: 4, transition: 'width .5s cubic-bezier(.2,.9,.2,1.1)' }} />
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '65%', width: 1, background: 'rgba(43,37,32,.2)' }} />
                          </div>
                          <span className="mono" style={{ textAlign: 'right', fontSize: 11, color: barColor }}>{barPct}%</span>
                        </div>
                      )
                    })}
                    {/* Narrative velocity */}
                    {(() => {
                      const nv = data.narrative_velocity
                      const nvColor = nv.label === 'Accelerating' ? '#7CB518' : nv.label === 'Steady' ? '#A88B4C' : nv.label === 'Peaked' ? '#B83A26' : '#8C7E6F'
                      return (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed rgba(43,37,32,.12)' }}>
                          <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', marginBottom: 7 }}>NARRATIVE VELOCITY</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                            <span className="serif" style={{ fontSize: 20, color: nvColor, lineHeight: 1 }}>{nv.label}</span>
                            {nv.ratio > 0 && (
                              <span className="mono" style={{ fontSize: 10, color: nvColor, background: `${nvColor}18`, padding: '2px 7px', borderRadius: 999, border: `1px solid ${nvColor}30` }}>
                                {nv.ratio.toFixed(1)}×
                              </span>
                            )}
                          </div>
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.55 }}>{nv.description}</p>
                        </div>
                      )
                    })()}
                    {/* Buyer composition */}
                    {data.buyer_composition && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed rgba(43,37,32,.12)' }}>
                        <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', marginBottom: 7 }}>WHO IS BUYING?</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {Object.entries(data.buyer_composition).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 110, fontSize: 13, color: 'var(--ink-soft)' }}>{k}</div>
                              <div style={{ flex: 1, height: 9, background: 'rgba(43,37,32,.06)', borderRadius: 6, overflow: 'hidden' }}>
                                <div style={{ width: `${v}%`, height: '100%', background: k === 'Strategic' ? '#7CB518' : k === 'Private Equity' ? '#A88B4C' : k === 'VC' ? '#B83A26' : '#8C7E6F' }} />
                              </div>
                              <div style={{ width: showRawCounts ? 72 : 44, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', color: 'var(--ink)' }}>
                                {showRawCounts ? `${data.buyer_counts?.[k] ?? 0} of ${buyerSampleCount}` : `${v}%`}
                              </div>
                            </div>
                          ))}
                        </div>
                        {(() => {
                          const entries = Object.entries(data.buyer_composition || {})
                          const top = entries.sort((a, b) => b[1] - a[1])[0]
                          if (top && showRawCounts) {
                            const count = data.buyer_counts?.[top[0]] ?? 0
                            return <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)' }}>{top[0]} appears in {count} of {buyerSampleCount} observed signal(s). Too small for a percentage read.</div>
                          }
                          if (top) return <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)' }}>{top[0]} account for {top[1]}% of recent signals, suggesting the dominant buyer behaviour.</div>
                          return null
                        })()}
                      </div>
                    )}
                  </div>
                  {/* Why Premia Thinks This */}
                  {data.why_bullets && data.why_bullets.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 8 }}>WHY PREMIA THINKS THIS</div>
                      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10 }}>
                        {data.why_bullets.slice(0,5).map((b, i) => (
                          <div key={i} style={{ background: 'rgba(255,255,255,.55)', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(43,37,32,.06)', fontSize: 13 }}>{'✓ '}{b}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <SkeletonChart isMobile={isMobile} />
            )}

            {/* MARKET CONTEXT PANEL — before chart when deal data is thin */}
            {revealed.market && data?.low_data_mode && data.market_context && (
              <div className="fade-up">
                <MarketContextPanel data={data.market_context} isMobile={isMobile} />
              </div>
            )}
            {loading && !data && (
              <div style={{ height: 140, background: 'rgba(43,37,32,.03)', borderRadius: 14, border: '1px solid rgba(43,37,32,.07)' }} className="shimmer" />
            )}

            {/* MARKET CONTEXT PANEL — after chart for data-rich searches */}
            {revealed.market && !data?.low_data_mode && data?.market_context && (
              <div className="fade-up">
                <MarketContextPanel data={data.market_context} isMobile={isMobile} />
              </div>
            )}

            {/* NARRATIVE */}
            {revealed.narrative && data ? (() => {
              const three = data.three_things ?? []
              const paras = data.thesis.split('\n\n').filter(Boolean)
              const orientation = paras[0]
              const analysis = paras.slice(1)
              return (
                <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {three.length > 0 && (
                    <section className="paper" style={{ padding: '16px 18px' }}>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 8 }}>THREE THINGS THAT STAND OUT</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {three.map((t, i) => (
                          <div key={i} style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>• {t}</div>
                        ))}
                      </div>
                    </section>
                  )}
                  {orientation && (
                    <section className="paper" style={{ padding: '22px 26px' }}>
                      <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', marginBottom: 14, fontWeight: 400 }}>The sector</div>
                      <div style={{ borderLeft: '2px solid rgba(43,37,32,.18)', paddingLeft: 18 }}>
                        {renderMarkdownParagraph(orientation, 'orientation', { fontSize: 15, lineHeight: 1.7, margin: 0, fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)", fontWeight: 400, color: 'var(--ink)' })}
                      </div>
                    </section>
                  )}
                  {analysis.length > 0 && (
                    <section className="paper" style={{ padding: '22px 26px' }}>
                      <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', marginBottom: 14, fontWeight: 400 }}>What the data says</div>
                      <div style={{ borderLeft: '2px solid rgba(43,37,32,.18)', paddingLeft: 18 }}>
                        {analysis.map((para, i) => (
                          <div key={i}>
                            {renderMarkdownParagraph(para, `analysis-${i}`, { fontSize: 15, lineHeight: 1.7, margin: '0 0 14px', fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)", fontWeight: 400, color: 'var(--ink)' })}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )
            })() : (
              <SkeletonNarrative />
            )}

            {/* EVIDENCE */}
            {revealed.evidence && data ? (
              <div className="fade-up">
                <section>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginBottom: 4 }}>WHAT&apos;S DRIVING THE SIGNAL</div>
                  <div className="serif" style={{ fontSize: 20, marginBottom: 12 }}>Recent transactions &amp; mentions</div>
                  {data.evidence.length === 0 ? (
                    <div style={{ padding: '20px 24px', background: 'rgba(43,37,32,.03)', borderRadius: 12, border: '1px solid rgba(43,37,32,.07)' }}>
                      <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-soft)', fontWeight: 500 }}>No confirmed transactions captured for this thesis.</p>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.65 }}>
                        This most often happens in non-English markets — local-language deal coverage isn&apos;t fully captured by our sources — or in sectors where activity is genuinely early and hasn&apos;t been widely reported. In frontier markets especially, absence of deal data is often a function of data coverage, not absence of activity.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.evidence.map((item, i) => (
                        <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center', background: '#FAF8F3', border: '1px solid rgba(43,37,32,.10)', borderRadius: 12, padding: '14px 18px', textDecoration: 'none', transition: 'transform .15s, box-shadow .15s' }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-1px)'; el.style.boxShadow = '0 6px 14px -10px rgba(43,37,32,.25)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'none'; el.style.boxShadow = 'none' }}>
                          <div style={{ minWidth: 0 }}>
                            {(() => {
                              const t = item.title.toLowerCase()
                              if (t.includes('series') || t.includes('raises') || t.includes('seed') || t.includes('growth')) return <div style={{ display: 'inline-block', padding: '4px 8px', background: 'rgba(43,37,32,.06)', borderRadius: 8, fontSize: 12, marginBottom: 8 }}>Growth Investment</div>
                              if (t.includes('acquir') || t.includes('acquisition') || t.includes('acquired by')) return <div style={{ display: 'inline-block', padding: '4px 8px', background: 'rgba(124,181,24,.12)', borderRadius: 8, fontSize: 12, marginBottom: 8 }}>Strategic Acquisition</div>
                              if (t.includes('buyout') || t.includes('take private') || t.includes('private equity')) return <div style={{ display: 'inline-block', padding: '4px 8px', background: 'rgba(168,139,76,.12)', borderRadius: 8, fontSize: 12, marginBottom: 8 }}>PE Buyout</div>
                              if (t.includes('minority stake') || t.includes('minority')) return <div style={{ display: 'inline-block', padding: '4px 8px', background: 'rgba(43,37,32,.08)', borderRadius: 8, fontSize: 12, marginBottom: 8 }}>Minority Stake</div>
                              return null
                            })()}
                            <div style={{ fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)", fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 5, lineHeight: 1.4 }}>{item.title}</div>
                            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-mute)', alignItems: 'center' }}>
                              <span className="mono">{item.source}</span>
                              <span className="mono">{item.published_date}</span>
                              {item.isTranslated && <span className="mono" style={{ color: 'var(--brass)', letterSpacing: '.06em' }}>translated</span>}
                            </div>
                          </div>
                          <span style={{ color: '#7CB518', fontSize: 18, opacity: .7 }}>↗</span>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <SkeletonEvidence />
            )}

          </div>
        )}

        {!loading && (
          <>
            {canShareAnalysis && data?.scenario_triggers && data.scenario_triggers.length > 0 && (
              <div style={{ marginTop: 28, maxWidth: 780, marginLeft: 'auto', marginRight: 'auto' }}>
                <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 8 }}>WHAT COULD CHANGE THIS SIGNAL?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {data.scenario_triggers.map((t, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,.9)', border: '1px solid rgba(43,37,32,.08)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 700 }}>{t.event}</div>
                      <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>{t.likelyImpact}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 40, textAlign: 'center' }}>
            <button onClick={() => router.push('/app')} style={{ appearance: 'none', border: '1px solid rgba(43,37,32,.18)', background: 'rgba(255,255,255,.5)', color: 'var(--ink-soft)', font: '500 13px Instrument Sans', padding: '10px 20px', borderRadius: 12, cursor: 'default' }}>
              {canShareAnalysis ? 'Search again' : 'Widen source set'}
            </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
        <header style={{ padding: '14px 24px', borderBottom: '1px solid rgba(43,37,32,.08)' }}>
          <span className="serif" style={{ fontSize: '1.4rem', color: 'var(--ink)' }}>
            Premia<span style={{ color: 'var(--terra)', fontSize: '0.6em', verticalAlign: 'super', marginLeft: 1 }}>·</span>
          </span>
        </header>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  )
}
