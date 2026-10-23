import { NextRequest, NextResponse } from 'next/server'
import { generateThesis, type ThesisParams } from '@/lib/thesis'
import { readThesisCache, writeThesisCache } from '@/lib/thesis/cache'
import { runWithTimer, StageTimer } from '@/lib/thesis/timing'

export const maxDuration = 60

const MAX_BODY_BYTES = 64 * 1024
const MAX_DEAL_ITEMS = 15
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

// Best-effort, per serverless instance.
const hits = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd?.split(',')[0]?.trim()) || req.headers.get('x-real-ip') || 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) {
    hits.forEach((times, key) => {
      if (times.every(t => now - t >= RATE_WINDOW_MS)) hits.delete(key)
    })
  }
  return false
}

function originAllowed(req: NextRequest): boolean {
  const source = req.headers.get('origin') ?? req.headers.get('referer')
  if (!source) return false
  let sourceHost: string
  try {
    sourceHost = new URL(source).host
  } catch {
    return false
  }
  const allowed = new Set<string>()
  const host = req.headers.get('host')
  if (host) allowed.add(host)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try { allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host) } catch { /* ignore */ }
  }
  return allowed.has(sourceHost)
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export async function POST(req: NextRequest) {
  if (!originAllowed(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const userInput = str(body.userInput, 500)?.trim()
  const sector = str(body.sector, 200)
  const geography = str(body.geography, 200)
  const consensusState = str(body.consensusState, 100)
  const signalTier = str(body.signalTier, 50)
  const count30d = num(body.count30d)
  const count90d = num(body.count90d)
  const count365d = num(body.count365d)
  const mediaCount90d = num(body.mediaCount90d)
  const confidencePercent = num(body.confidencePercent)
  const sourceCount = num(body.sourceCount)
  const activeMonths = num(body.activeMonths)
  if (
    !userInput || sector === null || geography === null || consensusState === null || signalTier === null ||
    count30d === null || count90d === null || count365d === null || mediaCount90d === null ||
    confidencePercent === null || sourceCount === null || activeMonths === null ||
    !Array.isArray(body.synthesisItems)
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
  }

  const expansionDescription = body.expansionDescription == null ? null : str(body.expansionDescription, 1000)
  const marketContext = body.marketContext && typeof body.marketContext === 'object'
    ? (body.marketContext as ThesisParams['marketContext'])
    : null

  try {
    const items = body.synthesisItems.slice(0, MAX_DEAL_ITEMS).flatMap((raw): ThesisParams['synthesisItems'] => {
      if (!raw || typeof raw !== 'object') return []
      const r = raw as Record<string, unknown>
      return [{
        title: str(r.title, 300) ?? undefined,
        url: str(r.url, 1000) ?? undefined,
        published_date: str(r.published_date, 40) ?? undefined,
        source: str(r.source, 200) ?? undefined,
      }]
    })
    const params: ThesisParams = {
      userInput,
      sector,
      geography,
      consensusState,
      count30d,
      count90d,
      count365d,
      mediaCount90d,
      synthesisItems: items,
      marketContext,
      signalTier,
      confidencePercent,
      sourceCount,
      activeMonths,
      expansionDescription,
    }
    // Dev-only switch so the eval script can turn the critic on; production always follows THESIS_CRITIC_ENABLED.
    const criticOverride = process.env.NODE_ENV !== 'production' && typeof body.critic === 'boolean' ? body.critic : undefined

    const timer = new StageTimer()
    const startedAt = Date.now()
    if (criticOverride === undefined) {
      const cached = await timer.time('cache_read', () => readThesisCache(userInput))
      if (cached) {
        console.log('[thesis-timing]', JSON.stringify({ thesis: userInput.slice(0, 80), cache: 'hit', ...timer.summary(), total_ms: Date.now() - startedAt }))
        return NextResponse.json({ thesis: cached.thesis, thesis_sources: cached.thesis_sources, meta: cached.meta })
      }
    }
    const result = await runWithTimer(timer, () => generateThesis(params, { critic: criticOverride }))
    if (criticOverride === undefined) await timer.time('cache_write', () => writeThesisCache(userInput, result))
    console.log('[thesis-timing]', JSON.stringify({
      thesis: userInput.slice(0, 80),
      cache: 'miss',
      writer_ms: result.meta.writer_ms,
      validator_ms: result.meta.validator_ms,
      fallback: result.meta.fallback,
      fallback_reason: result.meta.fallback_reason,
      ...timer.summary(),
      total_ms: Date.now() - startedAt,
    }))
    return NextResponse.json({ thesis: result.thesis, thesis_sources: result.thesis_sources, meta: result.meta })
  } catch (error: unknown) {
    console.error('Thesis error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Thesis generation failed' }, { status: 500 })
  }
}
