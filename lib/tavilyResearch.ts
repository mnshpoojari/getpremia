import { tavily } from '@tavily/core'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SourcedMetric<T> = T & {
  source_name: string
  source_url: string
}

export type CAGREstimate = SourcedMetric<{
  value: number
  period: string | null
}>

export type MarketSizeEstimate = SourcedMetric<{
  value_usd_bn: number
  year: number | null
}>

export type ValuationContext = {
  ev_revenue: number | null
  ev_ebitda: number | null
  source: string | null
  source_url: string | null
}

export type MarketCharacteristics = {
  competition_density: 'high' | 'medium' | 'low' | null
  capital_inflow_trend: 'increasing' | 'stable' | 'decreasing' | null
  media_heat: 'high' | 'medium' | 'low' | null
}

export type MarketResearch = {
  market_overview: {
    sector: string
    geography: string
  }
  growth_signals: {
    cagr_estimates: CAGREstimate[]
    market_size_estimates: MarketSizeEstimate[]
  }
  valuation_context: ValuationContext
  market_characteristics: MarketCharacteristics
  key_insights: string[]
  raw_snippets: string[]
}

// ── Domain blocklist — common SEO content farm patterns ───────────────────────

const BLOCKED_DOMAINS = new Set([
  'prnewswire.com', 'businesswire.com', 'globenewswire.com',
  'einpresswire.com', 'accesswire.com', 'openpr.com',
  'markets.businessinsider.com', 'finance.yahoo.com',
  'digitaljournal.com', 'whatech.com', 'custommarketinsights.com',
  'marketresearchfuture.com', 'cognitivemarketresearch.com',
  'dataintelo.com', 'factmr.com', 'futuremarketinsights.com',
])

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function isSpammy(url: string): boolean {
  return BLOCKED_DOMAINS.has(domainOf(url))
}

// ── Extraction helpers ─────────────────────────────────────────────────────────

function extractCAGR(text: string): { value: number; period: string | null } | null {
  const patterns = [
    /CAGR\s+(?:of\s+)?(\d+\.?\d*)\s*%/i,
    /(\d+\.?\d*)\s*%\s+CAGR/i,
    /CAGR[:\s]+(\d+\.?\d*)\s*%/i,
    /grow(?:ing|s|th)?\s+at\s+(?:a\s+)?(\d+\.?\d*)\s*%/i,
    /compound(?:ed|ing)?\s+annual.*?(\d+\.?\d*)\s*%/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const value = parseFloat(m[1])
      if (value > 0.5 && value < 60) {
        const period = text.match(/20\d\d\s*[-–—]\s*20\d\d/)?.[0]?.replace(/\s/g, '') ?? null
        return { value, period }
      }
    }
  }
  return null
}

function extractMarketSize(text: string): { value_usd_bn: number; year: number | null } | null {
  // Match patterns like "$76.2 billion", "USD 76.2 bn", "76.2 billion USD"
  const patterns = [
    /(?:USD|US\$|\$)\s*(\d[\d,]*\.?\d*)\s*(billion|bn)\b/i,
    /(\d[\d,]*\.?\d*)\s*(billion|bn)\s+(?:USD|US\$|\$)/i,
    /(?:market|size|valued?)\s+(?:at\s+)?(?:USD|US\$|\$)\s*(\d[\d,]*\.?\d*)\s*(billion|bn)/i,
    /(\d[\d,]*\.?\d*)\s*(billion|bn)\s+(?:market|industry)/i,
    // Trillion → convert
    /(?:USD|US\$|\$)\s*(\d[\d,]*\.?\d*)\s*(trillion)\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const raw = parseFloat(m[1].replace(/,/g, ''))
      if (!isFinite(raw) || raw <= 0) continue
      const unit = m[2]?.toLowerCase()
      const value_usd_bn = unit === 'trillion' ? raw * 1000 : raw
      if (value_usd_bn > 0.01 && value_usd_bn < 100_000) {
        const yearMatch = text.match(/\b(20\d\d)\b/)
        const year = yearMatch ? parseInt(yearMatch[1]) : null
        return { value_usd_bn, year }
      }
    }
  }
  return null
}

function extractEVMultiple(text: string, type: 'revenue' | 'ebitda'): number | null {
  const label = type === 'revenue' ? '(?:revenue|sales)' : '(?:EBITDA|ebitda)'
  const patterns = [
    new RegExp(`EV\\s*\\/\\s*${label}[^\\d]{0,20}(\\d+\\.?\\d*)\\s*x`, 'i'),
    new RegExp(`(\\d+\\.?\\d*)\\s*x\\s+EV\\s*\\/\\s*${label}`, 'i'),
    new RegExp(`${label}\\s+multiple[^\\d]{0,20}(\\d+\\.?\\d*)\\s*x`, 'i'),
    new RegExp(`valuation\\s+multiple[^\\d]{0,20}(\\d+\\.?\\d*)\\s*x`, 'i'),
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const v = parseFloat(m[1])
      if (v > 0.5 && v < 200) return v
    }
  }
  return null
}

function sourceName(url: string, title: string): string {
  const domain = domainOf(url)
  // Known quality sources get their brand name
  const KNOWN: Record<string, string> = {
    'mordorintelligence.com': 'Mordor Intelligence',
    'marketsandmarkets.com': 'MarketsandMarkets',
    'grandviewresearch.com': 'Grand View Research',
    'statista.com': 'Statista',
    'imarc.com': 'IMARC',
    'alliedmarketresearch.com': 'Allied Market Research',
    'fortunebusinessinsights.com': 'Fortune Business Insights',
    'ft.com': 'Financial Times',
    'reuters.com': 'Reuters',
    'bloomberg.com': 'Bloomberg',
    'wsj.com': 'Wall Street Journal',
    'economictimes.indiatimes.com': 'Economic Times',
    'livemint.com': 'Mint',
    'techcrunch.com': 'TechCrunch',
    'business-standard.com': 'Business Standard',
    'inc42.com': 'Inc42',
    'entrackr.com': 'Entrackr',
    'crunchbase.com': 'Crunchbase',
    'pitchbook.com': 'PitchBook',
  }
  return KNOWN[domain] ?? title ?? domain
}

function extractCompetitionDensity(snippets: string[]): 'high' | 'medium' | 'low' | null {
  const text = snippets.join(' ').toLowerCase()
  const high = ['highly competitive', 'intensely competitive', 'crowded market', 'saturated', 'hundreds of startups', 'fierce competition', 'fragmented with many']
  const low  = ['nascent market', 'early stage', 'few players', 'limited competition', 'underpenetrated', 'greenfield']
  if (high.some(s => text.includes(s))) return 'high'
  if (low.some(s => text.includes(s))) return 'low'
  // Presence of named competitors suggests at least medium density
  if (text.match(/competitors?\s+include|key players?\s+include|major players/i)) return 'medium'
  return null
}

function extractCapitalInflowTrend(snippets: string[]): 'increasing' | 'stable' | 'decreasing' | null {
  const text = snippets.join(' ').toLowerCase()
  const up   = ['investment surge', 'record funding', 'increasing investment', 'growing investment', 'strong inflows', 'vc funding rose', 'funding increased']
  const down = ['funding declined', 'investment slowdown', 'funding winter', 'pullback', 'reduced investment', 'vc funding fell']
  if (up.some(s => text.includes(s))) return 'increasing'
  if (down.some(s => text.includes(s))) return 'decreasing'
  return 'stable'
}

function extractMediaHeat(snippets: string[]): 'high' | 'medium' | 'low' | null {
  const text = snippets.join(' ').toLowerCase()
  const high = ['booming', 'explosive growth', 'rapidly expanding', 'hot sector', 'high interest', 'significant attention']
  const low  = ['niche market', 'limited coverage', 'underreported', 'quiet sector']
  if (high.some(s => text.includes(s))) return 'high'
  if (low.some(s => text.includes(s))) return 'low'
  return 'medium'
}

function extractKeyInsights(snippets: string[], maxInsights = 3): string[] {
  const insights: string[] = []
  for (const snippet of snippets) {
    // Pull sentences that contain signal words
    const sentences = snippet
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.length > 40 && s.length < 220)
      .filter(s => /(?:key|driver|trend|growth|challenge|opportunity|significant|notable|dominant|leading|major)/i.test(s))
    for (const s of sentences) {
      if (insights.length >= maxInsights) break
      const clean = s.trim().replace(/\s+/g, ' ')
      if (!insights.some(i => i.slice(0, 30) === clean.slice(0, 30))) {
        insights.push(clean)
      }
    }
    if (insights.length >= maxInsights) break
  }
  return insights
}

// ── Tavily search layer ────────────────────────────────────────────────────────

type TavilyResult = {
  title: string
  url: string
  content: string
  score: number
}

async function runSearch(client: ReturnType<typeof tavily>, query: string): Promise<TavilyResult[]> {
  try {
    const res = await client.search(query, {
      maxResults: 3,
      searchDepth: 'advanced',
      includeAnswer: false,
    })
    return (res.results ?? []).filter(r => !isSpammy(r.url))
  } catch {
    return []
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getMarketResearch(
  sector: string,
  geography: string,
  searchQuery?: string
): Promise<MarketResearch> {
  const client = tavily({ apiKey: process.env.TAVILY_API_KEY! })
  const geo = geography
  // Use caller-supplied search query (e.g. "protein India") when available —
  // it's more specific than the broad sector label (e.g. "Agriculture Tech")
  const sec = searchQuery ?? sector

  // Run all searches in parallel
  const [cagrResults, sizeResults, valuationResults, fundingResults, competitiveResults, trendsResults] =
    await Promise.all([
      runSearch(client, `${geo} ${sec} market CAGR compound annual growth rate`),
      runSearch(client, `${geo} ${sec} market size billion USD revenue`),
      runSearch(client, `${sec} ${geo} EV revenue multiple EV EBITDA valuation`),
      runSearch(client, `${geo} ${sec} startup funding investment venture capital 2024`),
      runSearch(client, `${geo} ${sec} competitive landscape key players market`),
      runSearch(client, `${geo} ${sec} market trends emerging opportunities 2024`),
    ])

  // Deduplicate across all results by URL
  const seenUrls = new Set<string>()
  const allResults: TavilyResult[] = []
  for (const batch of [cagrResults, sizeResults, valuationResults, fundingResults, competitiveResults, trendsResults]) {
    for (const r of batch) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url)
        allResults.push(r)
      }
    }
  }

  const geoLower = geo.toLowerCase()

  // Common alternate forms for geographies — Tavily results rarely use the full name
  const GEO_ALIASES: Record<string, string[]> = {
    'united states': ['united states', ' us ', 'u.s.', 'usa', 'american', 'north america'],
    'united kingdom': ['united kingdom', ' uk ', 'u.k.', 'british', 'england'],
    'india': ['india', 'indian'],
    'germany': ['germany', 'german'],
    'france': ['france', 'french'],
    'southeast asia': ['southeast asia', 'sea region', 'asean'],
    'middle east': ['middle east', 'mena', 'gcc'],
    'latin america': ['latin america', 'latam'],
    'south africa': ['south africa', 'southern africa'],
    'eastern europe': ['eastern europe', 'cee'],
  }
  const geoAliases = GEO_ALIASES[geoLower] ?? [geoLower]
  const matchesGeo = (text: string) => {
    const t = text.toLowerCase()
    return geoAliases.some(alias => t.includes(alias))
  }

  // Extract CAGR estimates — require geography term in the snippet to avoid
  // picking up global market figures that mention the geography incidentally
  const cagrEstimates: CAGREstimate[] = []
  for (const r of [...cagrResults, ...sizeResults]) {
    const text = r.content + ' ' + r.title
    if (!matchesGeo(text)) continue
    const extracted = extractCAGR(text)
    if (extracted) {
      cagrEstimates.push({
        ...extracted,
        source_name: sourceName(r.url, r.title),
        source_url: r.url,
      })
    }
  }

  // Extract market size estimates — same geo-relevance guard
  const sizeEstimates: MarketSizeEstimate[] = []
  for (const r of [...sizeResults, ...cagrResults]) {
    const text = r.content + ' ' + r.title
    if (!matchesGeo(text)) continue
    const extracted = extractMarketSize(text)
    if (extracted) {
      sizeEstimates.push({
        ...extracted,
        source_name: sourceName(r.url, r.title),
        source_url: r.url,
      })
    }
  }

  // Extract valuation multiples
  let ev_revenue: number | null = null
  let ev_ebitda: number | null = null
  let valuationSource: string | null = null
  let valuationSourceUrl: string | null = null

  for (const r of valuationResults) {
    const text = r.content + ' ' + r.title
    ev_revenue = ev_revenue ?? extractEVMultiple(text, 'revenue')
    ev_ebitda  = ev_ebitda  ?? extractEVMultiple(text, 'ebitda')
    if ((ev_revenue != null || ev_ebitda != null) && !valuationSource) {
      valuationSource    = sourceName(r.url, r.title)
      valuationSourceUrl = r.url
    }
  }

  // Extract market characteristics from competitive + funding + trends snippets
  const characteristicSnippets = [
    ...competitiveResults.map(r => r.content),
    ...fundingResults.map(r => r.content),
    ...trendsResults.map(r => r.content),
  ]

  // Extract key insights from all results, weighted toward research & news
  const insightSnippets = allResults
    .sort((a, b) => b.score - a.score)
    .map(r => r.content)

  return {
    market_overview: { sector: sec, geography: geo },

    growth_signals: {
      cagr_estimates:        cagrEstimates,
      market_size_estimates: sizeEstimates,
    },

    valuation_context: {
      ev_revenue,
      ev_ebitda,
      source:     valuationSource,
      source_url: valuationSourceUrl,
    },

    market_characteristics: {
      competition_density:  extractCompetitionDensity(characteristicSnippets),
      capital_inflow_trend: extractCapitalInflowTrend([...fundingResults.map(r => r.content)]),
      media_heat:           extractMediaHeat(insightSnippets),
    },

    key_insights: extractKeyInsights(insightSnippets),

    // Top results for Gemini synthesis — scored, deduplicated, with URLs for attribution
    raw_snippets: allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(r => `SOURCE: ${sourceName(r.url, r.title)}\nURL: ${r.url}\n${r.content.slice(0, 350)}`),
  }
}
