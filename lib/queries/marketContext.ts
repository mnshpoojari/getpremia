import { GoogleGenerativeAI } from '@google/generative-ai'
import { getMarketResearch, type MarketResearch } from '../tavilyResearch'

// ── Types ──────────────────────────────────────────────────────────────────────

export type MarketContextField = {
  value: number | null
  source_name: string | null
  source_url: string | null
  geography_scope?: string | null
}

export type MarketContextResult = {
  cagr: MarketContextField & { period: string | null }
  market_size: MarketContextField & { year: number | null }
  ev_revenue: MarketContextField & { context: string | null }
  ev_ebitda: MarketContextField & { context: string | null }
  key_insight: string | null
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  }
}

async function checkCache(
  sector: string,
  geography: string
): Promise<{ result: MarketContextResult; fetched_at: string } | null> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    select: 'result,fetched_at',
    sector: `eq.${sector}`,
    geography: `eq.${geography}`,
    fetched_at: `gte.${cutoff}`,
    limit: '1',
  })
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/market_context_cache?${params}`, {
      headers: sbHeaders(),
    })
    if (!res.ok) return null
    const rows = (await res.json()) as { result: MarketContextResult; fetched_at: string }[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function upsertCache(
  sector: string,
  geography: string,
  result: MarketContextResult
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/market_context_cache`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ sector, geography, result, fetched_at: new Date().toISOString() }),
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

async function logQuery(
  sector: string,
  geography: string,
  cache_hit: boolean,
  result: MarketContextResult | null
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sector_query_log`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        sector,
        geography,
        cache_hit,
        cagr_found: result?.cagr?.value != null,
        market_size_found: result?.market_size?.value != null,
        ev_revenue_found: result?.ev_revenue?.value != null,
        ev_ebitda_found: result?.ev_ebitda?.value != null,
      }),
    })
  } catch {
    // Log failure is non-fatal
  }
}

// ── Source credibility ranking ─────────────────────────────────────────────────

// Lower index = higher credibility
const CREDIBILITY_ORDER = [
  'mordorintelligence.com', 'marketsandmarkets.com', 'grandviewresearch.com',
  'statista.com', 'imarcgroup.com', 'alliedmarketresearch.com',
  'fortunebusinessinsights.com', 'kpmg.com', 'pwc.in', 'pwc.com',
  'ey.com', 'deloitte.com', 'mckinsey.com', 'bcg.com',
  'ft.com', 'bloomberg.com', 'reuters.com', 'wsj.com',
  'economictimes.indiatimes.com', 'livemint.com', 'business-standard.com',
]

function credibilityScore(url: string): number {
  const domain = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
  const idx = CREDIBILITY_ORDER.indexOf(domain)
  return idx === -1 ? CREDIBILITY_ORDER.length : idx
}

function bestEstimate<T extends { source_url: string }>(estimates: T[]): T | null {
  if (estimates.length === 0) return null
  return [...estimates].sort((a, b) => credibilityScore(a.source_url) - credibilityScore(b.source_url))[0]
}

// ── Gemini: key insight only ───────────────────────────────────────────────────
// Source URLs come from Tavily extraction — Gemini only writes key_insight.

async function synthesiseKeyInsight(research: MarketResearch): Promise<string | null> {
  const snippetBlock = research.raw_snippets.slice(0, 6).join('\n\n')
  const prompt = `You are a capital markets analyst. Based only on these retrieved market research snippets about the "${research.market_overview.sector}" sector in "${research.market_overview.geography}", write one sharp sentence about the single most important market dynamic a deal professional should know right now.

Requirements:
- Specific — name a number, a company, a policy, or a named structural shift
- No generic phrases: "significant growth", "driven by adoption", "untapped potential", "robust growth", "substantial expansion"
- One sentence only. No preamble.

SNIPPETS:
${snippetBlock}

Return only the sentence.`

  try {
    const genai  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model  = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
    const result = await model.generateContent(prompt)
    const text   = result.response.text().trim().split('\n')[0]
    return text.length > 20 ? text : null
  } catch {
    return null
  }
}

// ── Assemble final result from extraction layer + Gemini insight ───────────────

async function buildResult(research: MarketResearch): Promise<MarketContextResult | null> {
  const bestCAGR = bestEstimate(research.growth_signals.cagr_estimates)
  const bestSize = bestEstimate(research.growth_signals.market_size_estimates)
  const val      = research.valuation_context

  const key_insight = await synthesiseKeyInsight(research)

  return {
    cagr: {
      value:       bestCAGR?.value       ?? null,
      period:      bestCAGR?.period      ?? null,
      source_name: bestCAGR?.source_name ?? null,
      source_url:  bestCAGR?.source_url  ?? null,
      geography_scope: bestCAGR?.geography_scope ?? null,
    },
    market_size: {
      value:       bestSize?.value_usd_bn ?? null,
      year:        bestSize?.year         ?? null,
      source_name: bestSize?.source_name  ?? null,
      source_url:  bestSize?.source_url   ?? null,
      geography_scope: bestSize?.geography_scope ?? null,
    },
    ev_revenue: {
      value:       val.ev_revenue,
      context:     val.ev_revenue != null ? 'median of listed peers' : null,
      source_name: val.source,
      source_url:  val.source_url,
      geography_scope: val.geography_scope,
    },
    ev_ebitda: {
      value:       val.ev_ebitda,
      context:     val.ev_ebitda != null ? 'median of listed peers' : null,
      source_name: val.source,
      source_url:  val.source_url,
      geography_scope: val.geography_scope,
    },
    key_insight,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getMarketContext(
  sector: string,
  geography: string,
  searchQuery?: string
): Promise<MarketContextResult | null> {
  // Cache under the specific search query when provided, not the broad sector
  // label — "protein" and "Agriculture Tech" should have separate cache entries
  const cacheKey = searchQuery ?? sector
  try {
    const cached = await checkCache(cacheKey, geography)
    if (cached) {
      await logQuery(cacheKey, geography, true, cached.result)
      return cached.result
    }

    // Tavily retrieves, Gemini synthesises
    const research = await getMarketResearch(sector, geography, searchQuery)
    const result   = await buildResult(research)

    if (result) {
      await Promise.all([
        upsertCache(cacheKey, geography, result),
        logQuery(cacheKey, geography, false, result),
      ])
    }

    return result
  } catch {
    return null
  }
}
