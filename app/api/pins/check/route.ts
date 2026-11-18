import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'

export const maxDuration = 45

// ── Types ──────────────────────────────────────────────────────────────────────

type PinInput = {
  id: string
  text: string        // e.g. "Fintech in India"
  state: string       // state at time of pinning
  pinned_at?: string  // ISO date — used to compute "X weeks ago"
  deals30?: number
  deals90?: number
  media?: number
}

type PinResult = {
  id: string
  text: string
  original_state: string
  current_state: string
  moved: boolean
  direction: 'up' | 'down' | 'none'  // up = more signal, down = less
  weeks_ago: number
  current_deals30: number
  current_deals90: number
  current_media90: number
  deal_delta_90d: number
  media_delta_90d: number
}

// ── Geo aliases (mirrors analyse route) ───────────────────────────────────────

const GEO_ALIASES: Record<string, string[]> = {
  'United States': ['us', 'u.s.', 'united states', 'america', 'american'],
  'India':         ['india', 'indian'],
  'United Kingdom':['uk', 'u.k.', 'britain', 'british', 'england'],
  'Germany':       ['germany', 'german'],
  'France':        ['france', 'french'],
  'Southeast Asia':['southeast asia', 'sea', 'asean', 'singapore', 'indonesia', 'thailand', 'vietnam', 'malaysia'],
  'Middle East':   ['middle east', 'mena', 'gulf', 'uae', 'saudi', 'qatar'],
  'Australia':     ['australia', 'australian'],
  'China':         ['china', 'chinese'],
  'Africa':        ['africa', 'african', 'nigeria', 'kenya', 'south africa'],
  'Latin America': ['latin america', 'latam', 'brazil', 'mexico', 'colombia'],
  'Brazil':        ['brazil', 'brazilian'],
  'Japan':         ['japan', 'japanese'],
  'Indonesia':     ['indonesia', 'indonesian'],
}

// Signal hierarchy for direction inference
const SIGNAL_RANK: Record<string, number> = {
  'EARLY SIGNAL': 4,
  'CONSENSUS':    3,
  'ACTIVE':       3,
  'ESTABLISHED':  2,
  'HYPE':         2,
  'COOLING':      1,
  'QUIET':        1,
  'NARRATIVE':    1,
}

// ── Consensus logic (simplified — no maturity lookup, no Gemini) ──────────────

function computeState(dealCount90d: number, dealCount30d: number, mediaCount90d: number): string {
  const priorRate = Math.max((dealCount90d - dealCount30d) / 60, 0.05)
  const velocityRatio = (dealCount30d / 30) / priorRate
  const accelerating = velocityRatio >= 1.5

  if (dealCount90d >= 3 && dealCount90d > mediaCount90d * 1.5) {
    return accelerating ? 'EARLY SIGNAL' : 'EARLY SIGNAL'
  }
  if (dealCount90d >= 3 && mediaCount90d >= dealCount90d * 0.8) {
    return 'CONSENSUS'
  }
  if (dealCount90d < 3 && mediaCount90d >= 5) {
    return 'HYPE'
  }
  if (accelerating && dealCount90d >= 1) {
    return 'EARLY SIGNAL'
  }
  return 'QUIET'
}

// ── News fetching ─────────────────────────────────────────────────────────────

const DEAL_KEYWORDS = ['acquires', 'acquisition', 'merger', 'buyout', 'stake', 'funding', 'raises', 'invested']

function nDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d
}

async function fetchCount(query: string, cutoff90: Date, cutoff30: Date): Promise<{ c90: number; c30: number }> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const parser = new Parser({ timeout: 6000 })
    const feed = await parser.parseURL(url)
    let c90 = 0, c30 = 0
    for (const item of feed.items ?? []) {
      const pub = item.pubDate ? new Date(item.pubDate) : null
      if (!pub || pub < cutoff90) continue
      const t = (item.title ?? '').toLowerCase()
      if (!DEAL_KEYWORDS.some(kw => t.includes(kw))) continue
      c90++
      if (pub >= cutoff30) c30++
    }
    return { c90, c30 }
  } catch {
    return { c90: 0, c30: 0 }
  }
}

async function fetchMediaCount(query: string, cutoff90: Date): Promise<number> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const parser = new Parser({ timeout: 6000 })
    const feed = await parser.parseURL(url)
    let count = 0
    for (const item of feed.items ?? []) {
      const pub = item.pubDate ? new Date(item.pubDate) : null
      if (pub && pub >= cutoff90) count++
    }
    return count
  } catch {
    return 0
  }
}

// ── Parse "Sector in Geography" ───────────────────────────────────────────────

function parsePin(text: string): { sector: string; geography: string } {
  const idx = text.lastIndexOf(' in ')
  if (idx > 0) {
    return { sector: text.slice(0, idx).trim(), geography: text.slice(idx + 4).trim() }
  }
  return { sector: text.trim(), geography: '' }
}

// ── Check a single pin ────────────────────────────────────────────────────────

async function checkPin(pin: PinInput): Promise<PinResult> {
  const { sector, geography } = parsePin(pin.text)
  const cutoff90 = nDaysAgo(90)
  const cutoff30 = nDaysAgo(30)

  const geoClause = geography ? ` "${geography}"` : ''
  const dealQuery = `"${sector}"${geoClause} acquires OR merger OR funding OR stake OR buyout`
  const mediaQuery = `"${sector}"${geoClause}`

  const [{ c90: dealCount90d, c30: dealCount30d }, mediaCount90d] = await Promise.all([
    fetchCount(dealQuery, cutoff90, cutoff30),
    fetchMediaCount(mediaQuery, cutoff90),
  ])

  const current_state = computeState(dealCount90d, dealCount30d, mediaCount90d)
  const deal_delta_90d = dealCount90d - (pin.deals90 ?? 0)
  const media_delta_90d = mediaCount90d - (pin.media ?? 0)
  const moved = current_state !== pin.state || Math.abs(deal_delta_90d) >= 2 || Math.abs(media_delta_90d) >= 5

  const origRank = SIGNAL_RANK[pin.state] ?? 1
  const currRank = SIGNAL_RANK[current_state] ?? 1
  const direction: 'up' | 'down' | 'none' = currRank !== origRank
    ? currRank > origRank ? 'up' : 'down'
    : deal_delta_90d > 0 || media_delta_90d > 0 ? 'up'
      : deal_delta_90d < 0 || media_delta_90d < 0 ? 'down'
        : 'none'

  const weeks_ago = pin.pinned_at
    ? Math.max(1, Math.round((Date.now() - new Date(pin.pinned_at).getTime()) / (7 * 24 * 60 * 60 * 1000)))
    : 0

  return {
    id:             pin.id,
    text:           pin.text,
    original_state: pin.state,
    current_state,
    moved,
    direction,
    weeks_ago,
    current_deals30: dealCount30d,
    current_deals90: dealCount90d,
    current_media90: mediaCount90d,
    deal_delta_90d,
    media_delta_90d,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { pins }: { pins: PinInput[] } = await req.json()
    if (!Array.isArray(pins) || pins.length === 0) {
      return NextResponse.json({ results: [] })
    }

    // Cap at 5 pins to stay within maxDuration — check most recently pinned first
    const toCheck = [...pins].sort((a, b) =>
      new Date(b.pinned_at ?? 0).getTime() - new Date(a.pinned_at ?? 0).getTime(),
    ).slice(0, 5)

    const results = await Promise.all(toCheck.map(checkPin))
    return NextResponse.json({ results })
  } catch (err) {
    console.error('pins/check error:', err)
    return NextResponse.json({ results: [] })
  }
}
