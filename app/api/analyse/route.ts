import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'
import { buildFactsOnly } from '@/lib/thesis/validate'
import { generateContent } from '@/lib/thesis'
import { MODELS } from '@/lib/thesis/config'
import { prefetchSectorResearch } from '@/lib/thesis/evidence'
import { StageTimer, runWithTimer, timed } from '@/lib/thesis/timing'
import { getMarketContext } from '@/lib/queries/marketContext'
import { dealExclusionReason, hasDealTransactionPhrase } from '@/lib/dealRules'
import { SIGNAL_THRESHOLDS, activeMonthsInWindow, calculateMomentum, getSignalTier, hasDocumentedPriorPeak, shouldShowDealTrend, shouldShowSignalGap, toPercentages } from '@/lib/signalLogic'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractJSON(text: string): Record<string, unknown> {
  const clean = text.trim()
  if (clean.includes('```')) {
    for (const block of clean.split('```')) {
      const stripped = block.replace(/^json\s*/, '').trim()
      try { return JSON.parse(stripped) } catch {}
    }
  }
  return JSON.parse(clean)
}

function nDaysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Step 1: Parse thesis ───────────────────────────────────────────────────────

async function parseThesis(thesis: string) {
  const prompt = `Parse this investment thesis into structured components.
Return ONLY JSON, no explanation.

Thesis: "${thesis}"

{
  "sector": "match to one of: Healthcare IT, Climate Infrastructure, B2B SaaS, Fintech, Consumer Tech, Industrial Tech, Real Estate, Energy, Financial Services, Media & Entertainment, Retail & Consumer, Logistics & Supply Chain, Education Tech, Defence & Aerospace, Agriculture Tech, Other",
  "sub_sector": "the specific niche within that sector, as the user stated it — e.g. 'femtech', 'hospital management software', 'buy now pay later'. Use the user's exact words, not a generic label. Leave empty string if the thesis is already at sector level.",
  "geography": "match to one of: United States, India, United Kingdom, Germany, France, Southeast Asia, Middle East, Australia, China, Africa, Nigeria, Kenya, South Africa, Latin America, Brazil, Mexico, Colombia, Indonesia, Vietnam, Turkey, Pakistan, Bangladesh, Eastern Europe, Central Asia, Japan, Other",
  "raw_query": "2-4 words for Google News search — use the sector/product terms only, never investment strategy words like 'roll-ups', 'consolidation', 'vertical integration', 'buyout strategy'. e.g. for 'Healthcare IT roll-ups in the US' → 'healthcare IT'; for 'femtech in the UK' → 'femtech UK'; for 'B2B SaaS Germany' → 'B2B SaaS Germany'"
}`

  return extractJSON(await timed('parse', () => generateContent(prompt, MODELS.parse, 'parse'))) as {
    sector: string
    sub_sector: string
    geography: string
    raw_query: string
  }
}

// ── Step 1b: Sector maturity classification ────────────────────────────────────

type Maturity = 'MATURE' | 'EMERGING' | 'NASCENT'

// Hardcoded overrides for unambiguously mature sector/geo combinations.
// Keyed as "sector_lowercase|geo_lowercase". Bypasses Gemini to avoid
// misclassification of well-established markets as EMERGING.
const KNOWN_MATURE: Record<string, string> = {
  'b2b saas|united states': 'US enterprise software has been a mature PE and strategic M&A market since the early 2010s.',
  'fintech|united states': 'US fintech is a deep, consolidated market with decades of deal history.',
  'healthcare it|united states': 'US healthcare IT is a well-established category with consistent institutional deal flow.',
  'financial services|united states': 'US financial services M&A is among the most active and mature deal markets globally.',
  'logistics & supply chain|united states': 'US logistics is a mature, heavily consolidated sector.',
  'real estate|united states': 'US commercial real estate M&A has decades of institutional capital behind it.',
  'energy|united states': 'US energy M&A is a century-old, highly liquid market.',
  'media & entertainment|united states': 'US media M&A is a mature, well-documented sector.',
  'b2b saas|united kingdom': 'UK enterprise software has been an active deal market for over two decades.',
  'financial services|united kingdom': 'UK financial services is one of the deepest M&A markets globally.',
  'fintech|united kingdom': 'UK fintech is a mature, well-capitalised market anchored by London.',
  'b2b saas|germany': 'German Mittelstand software M&A is a mature and active category.',
  'financial services|germany': 'German financial services M&A has deep institutional roots.',
  'energy|middle east': 'Middle East energy is dominated by sovereign capital with decades of transaction history.',
  'financial services|india': 'Indian financial services M&A is a mature and highly active category.',
  'real estate|united kingdom': 'UK commercial real estate is a deep, liquid institutional market.',
}

async function classifyMaturity(thesis: string, sector: string, geography: string): Promise<{ maturity: Maturity; reason: string }> {
  const key = `${sector.toLowerCase()}|${geography.toLowerCase()}`
  if (KNOWN_MATURE[key]) {
    return { maturity: 'MATURE', reason: KNOWN_MATURE[key] }
  }

  const prompt = `You are a senior investment analyst. Classify the maturity of this investment thesis based on your knowledge of how long this sector has been active in this geography, the depth of existing capital deployed, and how consolidated the market is.

Thesis: "${thesis}"
Sector: ${sector}
Geography: ${geography}

Return ONLY JSON:
{
  "maturity": "MATURE" | "EMERGING" | "NASCENT",
  "reason": "one sentence explaining the classification"
}

Guidelines:
- MATURE: sector has been an active deal market in this geography for 10+ years, with large incumbents, established buyer universes, and well-understood valuations. Default to MATURE when in doubt for US, UK, Germany, and Western Europe across most sectors. Examples: B2B SaaS in US, Fintech in US/UK, Healthcare IT in US, Financial Services in US/UK/Germany, Oil & Gas in US/Middle East, Logistics in US, Real Estate in US/UK.
- EMERGING: sector is active and growing but still developing its deal ecosystem in this geography, meaningful but not yet saturated. Examples: SaaS in India/Southeast Asia, Fintech in Africa/Latin America, Healthtech in Middle East.
- NASCENT: genuinely new theme with limited precedent transactions, buyer universe still forming. Examples: AI Infrastructure in MENA, Carbon Credits in LatAm, Agritech in Central Asia.

When the sector is well-established globally (SaaS, Fintech, Healthcare IT, Logistics, Financial Services) and the geography is a developed market (US, UK, Germany, France, Australia, Japan), classify as MATURE unless there is a specific reason it is underdeveloped there.`

  try {
    const parsed = extractJSON(await timed('maturity', () => generateContent(prompt, MODELS.maturity, 'maturity'))) as { maturity: Maturity; reason: string }
    if (['MATURE', 'EMERGING', 'NASCENT'].includes(parsed.maturity)) return parsed
    return { maturity: 'EMERGING', reason: 'Could not classify' }
  } catch {
    return { maturity: 'EMERGING', reason: 'Could not classify' }
  }
}

// ── Step 2: Deal data from Google News RSS ────────────────────────────────────

interface NewsItem {
  title: string
  url: string
  published_date: string
  source: string
  pub: Date
  isLocal?: boolean
  originalTitle?: string  // set after translation; original language title
}

interface StoredDealRow {
  title: string
  url: string
  source: string | null
  published_date: string | null
  buyer_name: string | null
  target_name: string | null
  is_deal?: boolean | null
  sector: string | null
  geography: string | null
  feed_role: 'deal_source' | 'narrative_source' | 'both' | null
  distinct_source_count?: number | null
}

interface StoredFeedItemRow {
  title: string
  url: string
  source: string | null
  published_date: string | null
  snippet: string | null
  feed_role?: 'deal_source' | 'narrative_source' | 'both' | null
  feed_region?: string | null
  feed_sector?: string | null
  feed_url?: string | null
}

interface FeedHealthRow {
  feed_url: string
  consecutive_failures: number
  region: string | null
  sector: string | null
  feed_role: string | null
}

async function fetchNewsItems(query: string, locale?: { hl: string; gl: string; ceid: string }): Promise<NewsItem[]> {
  try {
    const parser = new Parser({ timeout: 6000 })
    const { hl = 'en-US', gl = 'US', ceid = 'US:en' } = locale ?? {}
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`
    const feed = await parser.parseURL(url)
    return feed.items
      .filter(item => item.title && item.link)
      .map(item => {
        const pub = item.pubDate ? new Date(item.pubDate) : new Date()
        return {
          title: item.title!,
          url: item.link!,
          published_date: isoDate(pub),
          source: resolveSourceName(item.creator, item.title ?? '', item.link ?? ''),
          pub,
        }
      })
  } catch {
    return []
  }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function resolveSourceName(source: string | null | undefined, title: string, url: string): string {
  const label = source?.trim()
  if (label && !/\b(?:google\s?news|news\.google\.com|rss(?: feed)?|unknown source)\b/i.test(label)) return label
  const publisherSuffix = title.match(/\s[-–—]\s([^–—-]{2,80})$/)?.[1]?.trim()
  if (publisherSuffix && !/\b(?:google\s?news|news\.google\.com|rss(?: feed)?|unknown source)\b/i.test(publisherSuffix)) return publisherSuffix
  const domain = extractDomain(url)
  if (/\b(?:google\s?news|news\.google\.com)\b/i.test(label ?? '') || domain === 'news.google.com') return ''
  return domain
}

// Stop words excluded from title similarity comparison
const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'will',
  'its', 'are', 'was', 'been', 'into', 'new', 'over', 'deal', 'company',
])

function isSameStory(a: NewsItem, b: NewsItem): boolean {
  // No time window — the same acquisition can generate coverage for weeks.
  // 4 shared content words is specific enough to identify the same event
  // without merging genuinely different deals.
  const words = (t: string) => new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
      .filter(w => w.length > 3 && !TITLE_STOP_WORDS.has(w))
  )
  const wa = words(a.title)
  const wb = words(b.title)
  const shared = Array.from(wa).filter(w => wb.has(w)).length
  return shared >= 4
}

function deduplicateByContent(items: NewsItem[]): NewsItem[] {
  const kept: NewsItem[] = []
  for (const item of items) {
    if (!kept.some(k => isSameStory(k, item))) kept.push(item)
  }
  return kept
}

async function supabaseRest<T>(path: string): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service credentials missing')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

function titleMatchesQuery(title: string, snippet: string | null | undefined, rawQuery: string): boolean {
  const text = `${title} ${snippet ?? ''}`.toLowerCase()
  const terms = rawQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !GEO_STOP_TERMS.has(w))
  if (terms.length === 0) return true
  return terms.some(term => text.includes(term))
}

function roleFilterParam(column: string): string {
  return `or=(${column}.eq.deal_source,${column}.eq.both)`
}

function narrativeRoleFilterParam(column: string): string {
  return `or=(${column}.eq.narrative_source,${column}.eq.both)`
}

function isMissingDatabaseColumn(error: unknown): boolean {
  return error instanceof Error && /"code"\s*:\s*"42703"/i.test(error.message)
}

async function getStoredSignalData(sector: string, geography: string, rawQuery: string) {
  const cutoff365 = isoDate(nDaysAgo(365))
  const cutoff90 = isoDate(nDaysAgo(90))
  const cutoff180 = isoDate(nDaysAgo(180))
  const cutoff30 = isoDate(nDaysAgo(30))
  const sectorFilter = sector !== 'Other' ? `&sector=eq.${encodeURIComponent(sector)}` : ''
  const geographyFilter = geography !== 'Other' ? `&geography=eq.${encodeURIComponent(geography)}` : ''
  const regionFilter = geography !== 'Other' ? `&feed_region=eq.${encodeURIComponent(geography)}` : ''

  try {
    let storedDealRows: StoredDealRow[]
    let narrativeRows: StoredFeedItemRow[]
    let unhealthyFeeds: FeedHealthRow[]
    try {
      [storedDealRows, narrativeRows, unhealthyFeeds] = await Promise.all([
        supabaseRest<StoredDealRow[]>(
          `deals?select=title,url,source,published_date,buyer_name,target_name,is_deal,sector,geography,feed_role,distinct_source_count&is_deal=eq.true&published_date=gte.${cutoff365}&${roleFilterParam('feed_role')}${sectorFilter}${geographyFilter}&order=published_date.desc&limit=500`
        ),
        supabaseRest<StoredFeedItemRow[]>(
          `feed_items?select=title,url,source,published_date,snippet,feed_role,feed_region,feed_sector,feed_url&published_date=gte.${cutoff90}&${narrativeRoleFilterParam('feed_role')}${regionFilter}&order=published_date.desc&limit=500`
        ),
        supabaseRest<FeedHealthRow[]>(
          `feed_health?select=feed_url,consecutive_failures,region,sector,feed_role&consecutive_failures=gte.3${geography !== 'Other' ? `&or=(region.eq.${encodeURIComponent(geography)},region.is.null)` : ''}`
        ),
      ])
    } catch (error) {
      if (!isMissingDatabaseColumn(error)) throw error
      console.warn('[Supabase] Using legacy signal columns after a schema mismatch')
      ;[storedDealRows, narrativeRows] = await Promise.all([
        supabaseRest<StoredDealRow[]>(
          `deals?select=title,url,source,published_date,buyer_name,target_name,sector,geography&published_date=gte.${cutoff365}${sectorFilter}${geographyFilter}&order=published_date.desc&limit=500`
        ),
        supabaseRest<StoredFeedItemRow[]>(
          `feed_items?select=title,url,source,published_date&published_date=gte.${cutoff90}&order=published_date.desc&limit=500`
        ),
      ])
      unhealthyFeeds = []
    }
    const dealRows = storedDealRows.filter(row =>
      row.is_deal !== false &&
      Boolean(row.buyer_name || row.target_name) &&
      hasDealTransactionPhrase(row.title) &&
      !dealExclusionReason(
        row.title,
        row.source ?? extractDomain(row.url),
        row.source ?? '',
      )
    )

    const relevantNarrative = narrativeRows.filter(item =>
      (sector === 'Other' || !item.feed_sector || item.feed_sector === sector || titleMatchesQuery(item.title, item.snippet, rawQuery)) &&
      titleMatchesQuery(item.title, item.snippet, rawQuery)
    )
    const sourceForDeal = (row: StoredDealRow) =>
      resolveSourceName(row.source, row.title, row.url)

    if (dealRows.length === 0 && relevantNarrative.length === 0) return null

    const monthMap = new Map<string, number>()
    let count30d = 0
    let count90d = 0
    let countPrior90d = 0
    for (const row of dealRows) {
      if (!row.published_date) continue
      const d = new Date(row.published_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
      if (row.published_date >= cutoff90) count90d++
      else if (row.published_date >= cutoff180) countPrior90d++
      if (row.published_date >= cutoff30) count30d++
    }

    const now = new Date()
    const chartData = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      chartData.push({
        month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        deal_count: monthMap.get(key) ?? 0,
        partial: i === 11 || i === 0,
      })
    }

    const narrativeSources = new Set(
      relevantNarrative.map(item => resolveSourceName(item.source, item.title, item.url)).filter(Boolean)
    )
    const dealSources = new Set(
      dealRows.flatMap(item => sourceForDeal(item).split(',').map(source => source.trim()).filter(Boolean))
    )
    const mediaCount90d = relevantNarrative.length
    const mediaCount30d = relevantNarrative.filter(
      item => item.published_date && item.published_date >= cutoff30
    ).length

    return {
      dealData: {
        chartData,
        dealTapeItems: dealRows
          .filter(item => item.published_date)
          .map(item => ({
            title: item.title,
            url: item.url,
            published_date: item.published_date!,
            source: sourceForDeal(item),
          })),
        count30d,
        count90d,
        countPrior90d,
        count365d: dealRows.length,
        evidenceItems: dealRows.slice(0, 5).map(item => ({
          title: item.title,
          url: item.url,
          published_date: item.published_date ?? '',
          source: sourceForDeal(item),
        })),
        synthesisItems: dealRows.slice(0, 15).map(item => ({
          title: item.title,
          url: item.url,
          published_date: item.published_date ?? '',
          source: sourceForDeal(item),
        })),
        buyerItems: dealRows
          .filter(item => item.published_date && item.published_date >= cutoff90)
          .map(item => ({ title: item.title })),
      },
      mediaData: {
        score: mediaCount90d,
        score30d: mediaCount30d,
        uniqueSources: narrativeSources.size,
        sourceNames: Array.from(narrativeSources),
        headlines: relevantNarrative.slice(0, 10).map(item => item.title),
      },
      confidenceMetadata: {
        distinct_deal_source_count: dealSources.size,
        distinct_narrative_source_count: narrativeSources.size,
        source_names: Array.from(new Set([...Array.from(dealSources), ...Array.from(narrativeSources)])),
        feed_health_summary: unhealthyFeeds.map(feed => ({
          feed_url: feed.feed_url,
          consecutive_failures: feed.consecutive_failures,
          region: feed.region,
          sector: feed.sector,
          feed_role: feed.feed_role,
        })),
      },
    }
  } catch (err) {
    console.warn('[Supabase stored signal fallback]', err instanceof Error ? err.message.slice(0, 200) : String(err))
    return null
  }
}

// Geo terms excluded from topic relevance check
const GEO_STOP_TERMS = new Set([
  'india', 'china', 'united', 'states', 'kingdom', 'europe', 'middle',
  'east', 'southeast', 'asia', 'africa', 'japan', 'brazil', 'germany',
  'france', 'australia', 'singapore', 'indonesia', 'thailand', 'vietnam',
  'malaysia', 'saudi', 'arabia', 'emirates', 'north', 'south', 'west',
])

function isTopicRelevant(title: string, rawQuery: string): boolean {
  const t = title.toLowerCase()
  const terms = rawQuery.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length > 3 && !GEO_STOP_TERMS.has(w))
  if (terms.length === 0) return true
  return terms.every(term => t.includes(term))
}

type ItemRelevanceResult = {
  url: string
  title: string
  is_sector_match: boolean
  is_geography_match: boolean
  confidence: number
  reason: string
}

function deriveGeographyAliases(geography: string): string[] {
  if (geography === 'Other') return []
  return Array.from(new Set([
    ...(GEO_ALIASES[geography] ?? [geography.toLowerCase()]),
    geography.toLowerCase(),
  ]))
}

function heuristicItemRelevance(
  title: string,
  url: string,
  sector: string,
  geography: string,
  rawQuery: string
): ItemRelevanceResult {
  const text = title.toLowerCase()
  const queryTerms = rawQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !GEO_STOP_TERMS.has(w))
  const sectorTerms = sector.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !GEO_STOP_TERMS.has(w))
  const geographyAliases = deriveGeographyAliases(geography)
  const sectorMatch = sector === 'Other'
    ? queryTerms.some(term => text.includes(term))
    : sectorTerms.length > 0 && sectorTerms.every(term => text.includes(term) || queryTerms.some(q => q.includes(term)))
  const geographyMatch = geography === 'Other'
    ? true
    : geographyAliases.some(alias => text.includes(alias) || /\b(?:uae|gulf|gcc|dubai|abu dhabi)\b/.test(text) && alias.includes('uae'))
    || (geography === 'Middle East' && /\b(?:uae|dubai|abu dhabi|gcc|gulf|emirates|saudi|qatar|oman|kuwait|bahrain)\b/.test(text))
  const confidence = Math.min(0.99, (sectorMatch ? 0.55 : 0.15) + (geographyMatch ? 0.4 : 0.15))
  return {
    url,
    title,
    is_sector_match: sectorMatch,
    is_geography_match: geographyMatch,
    confidence,
    reason: sectorMatch && geographyMatch
      ? 'Matches thesis sector and geography terms.'
      : !sectorMatch
        ? 'Off-sector language or a different business category than the thesis.'
        : 'Geography mentions do not align with the thesis scope.'
  }
}

async function assessRelevanceBatch(
  items: Array<{ title: string; url: string }>,
  thesis: string,
  sector: string,
  geography: string,
  rawQuery: string
): Promise<Map<string, ItemRelevanceResult>> {
  if (items.length === 0) return new Map()

  const prompt = `Assess each item below for relevance to the thesis. Return ONLY JSON with this exact shape:
{"items":[{"key":"<unique item key>","title":"<title>","is_sector_match":true|false,"is_geography_match":true|false,"confidence":0.0,"reason":"one-line reason"}]}

Rules:
- Use true only when the item clearly fits the thesis sector and geography.
- Do not permit a title to count if it is off-topic or outside the named geography.
- One-line reason must be brief and specific.
- Keep the output valid JSON only.

Thesis: ${thesis}
Sector: ${sector}
Geography: ${geography}
Raw query: ${rawQuery}

Items:
${JSON.stringify(items.map((item, index) => ({ key: item.url || String(index), ...item })), null, 2)}`

  try {
    const raw = (await timed('relevance', () => generateContent(prompt, MODELS.relevance, 'relevance'))).trim()
    const parsed = JSON.parse(raw.includes('```') ? raw.split('```').find(block => block.trim().startsWith('{') || block.trim().startsWith('[')) ?? raw : raw) as { items?: Array<{ key: string; title: string; is_sector_match?: boolean; is_geography_match?: boolean; confidence?: number; reason?: string }> }
    const result = new Map<string, ItemRelevanceResult>()
    for (const item of parsed.items ?? []) {
      const key = item.key || item.title
      if (!key) continue
      const relevance = {
        url: key,
        title: item.title ?? '',
        is_sector_match: Boolean(item.is_sector_match),
        is_geography_match: Boolean(item.is_geography_match),
        confidence: Number(item.confidence ?? 0),
        reason: item.reason ?? 'No structured reason returned.'
      }
      result.set(key, relevance)
    }
    return result
  } catch {
    return new Map(items.map(item => [item.url || item.title, heuristicItemRelevance(item.title, item.url || item.title, sector, geography, rawQuery)]))
  }
}

const GEO_ALIASES: Record<string, string[]> = {
  'United States': ['us', 'u.s.', 'united states', 'america', 'american'],
  'India': ['india', 'indian'],
  'United Kingdom': ['uk', 'u.k.', 'britain', 'british', 'england'],
  'Germany': ['germany', 'german'],
  'France': ['france', 'french'],
  'Southeast Asia': ['southeast asia', 'sea', 'asean', 'singapore', 'indonesia', 'thailand', 'vietnam', 'malaysia', 'philippines'],
  'Middle East': ['middle east', 'mena', 'gulf', 'uae', 'dubai', 'abu dhabi', 'emirates', 'gcc', 'saudi', 'qatar', 'kuwait', 'bahrain', 'oman'],
  'Australia': ['australia', 'australian'],
  'China': ['china', 'chinese'],
  // Emerging / frontier
  'Africa': ['africa', 'african', 'nigeria', 'nigerian', 'kenya', 'kenyan', 'south africa', 'ghana', 'ethiopia', 'tanzania', 'egypt', 'morocc'],
  'Latin America': ['latin america', 'latam', 'brazil', 'brazilian', 'mexico', 'mexican', 'colombia', 'colombia', 'chile', 'chilean', 'peru', 'argentina', 'argentinian'],
  'Turkey': ['turkey', 'turkish', 'türkiye'],
  'Pakistan': ['pakistan', 'pakistani'],
  'Bangladesh': ['bangladesh', 'bangladeshi'],
  'Eastern Europe': ['eastern europe', 'poland', 'polish', 'romania', 'romanian', 'czech', 'hungary', 'hungarian', 'ukraine', 'ukrainian', 'bulgaria'],
  'Central Asia': ['central asia', 'kazakhstan', 'uzbekistan', 'azerbaij'],
  'Nigeria': ['nigeria', 'nigerian', 'lagos', 'abuja'],
  'Kenya': ['kenya', 'kenyan', 'nairobi'],
  'South Africa': ['south africa', 'south african', 'johannesburg', 'cape town'],
  'Indonesia': ['indonesia', 'indonesian', 'jakarta'],
  'Vietnam': ['vietnam', 'vietnamese', 'hanoi', 'ho chi minh'],
  'Brazil': ['brazil', 'brazilian', 'são paulo', 'sao paulo'],
  'Mexico': ['mexico', 'mexican'],
}

// Non-English Google News locales — keyed by geography name.
// Items fetched with these locales are tagged isLocal=true and translated before filtering.
const LOCALE_MAP: Record<string, { hl: string; gl: string; ceid: string }[]> = {
  'Japan':          [{ hl: 'ja',    gl: 'JP', ceid: 'JP:ja'       }],
  'Germany':        [{ hl: 'de',    gl: 'DE', ceid: 'DE:de'       }],
  'France':         [{ hl: 'fr',    gl: 'FR', ceid: 'FR:fr'       }],
  'Brazil':         [{ hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-BR'    }],
  'Mexico':         [{ hl: 'es',    gl: 'MX', ceid: 'MX:es'       }],
  'Colombia':       [{ hl: 'es',    gl: 'CO', ceid: 'CO:es'       }],
  'Indonesia':      [{ hl: 'id',    gl: 'ID', ceid: 'ID:id'       }],
  'Vietnam':        [{ hl: 'vi',    gl: 'VN', ceid: 'VN:vi'       }],
  'Turkey':         [{ hl: 'tr',    gl: 'TR', ceid: 'TR:tr'       }],
  'China':          [{ hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans'  }],
  'Middle East':    [{ hl: 'ar',    gl: 'SA', ceid: 'SA:ar'       }],
  'Eastern Europe': [{ hl: 'pl',    gl: 'PL', ceid: 'PL:pl'       },
                     { hl: 'ro',    gl: 'RO', ceid: 'RO:ro'       }],
  'Central Asia':   [{ hl: 'ru',    gl: 'KZ', ceid: 'KZ:ru'       }],
  'Bangladesh':     [{ hl: 'bn',    gl: 'BD', ceid: 'BD:bn'       }],
  'Southeast Asia': [{ hl: 'th',    gl: 'TH', ceid: 'TH:th'       }],
}

// Translate local-language titles to English in a single Gemini batch call.
// Mutates items in place: sets item.title = translated, item.originalTitle = original.
async function translateTitles(items: NewsItem[]): Promise<void> {
  const localItems = items.filter(i => i.isLocal)
  if (localItems.length === 0) return

  const titles = localItems.map(i => i.title)
  const prompt = `Translate these news headlines to English. Return ONLY a JSON array of strings, same count and order. Preserve company names, brand names, and proper nouns exactly. If a headline is already in English, return it unchanged.

Headlines: ${JSON.stringify(titles)}`

  try {
    const raw = (await timed('translate', () => generateContent(prompt, MODELS.translation, 'translation'))).trim()
    const cleaned = raw.includes('```') ? raw.split('```')[1].replace(/^json\s*/, '').trim() : raw
    const translated = JSON.parse(cleaned) as string[]
    if (Array.isArray(translated) && translated.length === localItems.length) {
      localItems.forEach((item, idx) => {
        if (translated[idx] && translated[idx] !== item.title) {
          item.originalTitle = item.title
          item.title = translated[idx]
        }
      })
    }
  } catch {
    // Translation failed — local items keep original titles; English filters will drop most of them
  }
}

function isDealArticle(
  title: string,
  geography?: string,
  rawQuery?: string,
  isLocal?: boolean,
  url?: string,
  topicQueries?: string[],
  geographyAliases?: string[],
): boolean {
  const t = title.toLowerCase()
  const domain = url ? extractDomain(url) : ''
  if (dealExclusionReason(title, domain)) return false
  const hasTransaction = hasDealTransactionPhrase(title)
  const hasQualifiedAcquisition = /\b(?:acquisition of|completes? (?:the )?acquisition)\b/i.test(title)
  const hasNamedCompany = /\b[A-Z][A-Za-z0-9&.'’-]{1,}\b/.test(title.replace(/\b(?:India|China|United|States|Kingdom|Europe|Asia|Africa|Japan|Brazil|Germany|France|Australia|Singapore|Indonesia|Thailand|Vietnam|Malaysia|Saudi|Arabia|Emirates|Top|Market|Software|SaaS|B2B)\b/g, ''))
  if (!hasTransaction && !hasQualifiedAcquisition) return false
  if (!hasNamedCompany) return false
  if (/\b(?:raises?|raised|secures?|secured)\b/i.test(title) &&
      !/\b(?:raises?|raised|secures?|secured)\s+(?:(?:us|usd)\s*)?(?:[$€£]\s*)?\d[\d,.]*(?:\s*(?:billion|bn|million|mn|thousand|k|m|b)\b)?|\bseries\s+[abc]\b|\bfunding\b/i.test(title)) return false
  if (topicQueries?.length) {
    if (!topicQueries.some(query => isTopicRelevant(title, query))) return false
  } else if (rawQuery && !isTopicRelevant(title, rawQuery)) return false
  if (geography && geography !== 'Other') {
    const aliases = geographyAliases ?? GEO_ALIASES[geography] ?? [geography.toLowerCase()]
    if (!aliases.some(a => t.includes(a))) return false
  }
  return true
}

function getExpandedQueryTerms(rawQuery: string, sector: string, geography: string) {
  const normalized = `${sector} ${rawQuery}`.toLowerCase()
  const sectorTerms = normalized.includes('financial service') || normalized.includes('finance')
    ? ['financial services', 'banking', 'wealth management', 'payments', 'asset management', 'insurance']
    : normalized.includes('defence') || normalized.includes('defense') || normalized.includes('aerospace')
      ? ['defence', 'defense', 'aerospace', 'military', 'drone', 'naval']
      : [rawQuery]
  const geographyTerms = geography === 'Middle East'
    ? ['Middle East', 'UAE', 'Dubai', 'Abu Dhabi', 'GCC']
    : geography === 'Other' ? [''] : [geography]
  return {
    topics: Array.from(new Set(sectorTerms)),
    geographies: Array.from(new Set(geographyTerms.filter(Boolean))),
  }
}

async function getDealData(geography: string, rawQuery: string, expansion?: { sector: string }, thesis?: string) {
  const cutoff365 = nDaysAgo(365)
  const cutoff90 = nDaysAgo(90)
  const cutoff180 = nDaysAgo(180)
  const cutoff30 = nDaysAgo(30)

  const expandedTerms = expansion
    ? getExpandedQueryTerms(rawQuery, expansion.sector, geography)
    : { topics: [rawQuery], geographies: geography === 'Other' ? [''] : [geography] }
  const geoAliases = geography !== 'Other'
    ? Array.from(new Set([...(GEO_ALIASES[geography] ?? [geography.toLowerCase()]), ...(expansion ? ['dubai', 'abu dhabi', 'emirates', 'gcc'] : [])]))
    : null
  const queryPairs = expansion
    ? expandedTerms.topics.slice(0, 6).map((topic, index) => ({
        topic,
        geo: expandedTerms.geographies[index % expandedTerms.geographies.length],
      }))
    : [{ topic: expandedTerms.topics[0], geo: expandedTerms.geographies[0] }]
  const englishQueries = queryPairs.flatMap(({ topic, geo }) => {
    const geoClause = geo ? ` "${geo}"` : ''
    return [
      `${topic}${geoClause} acquires OR acquired OR merger OR "takes stake" OR buyout OR "roll-up"`,
      `${topic}${geoClause} raises OR "funding round" OR "series a" OR "series b" OR "series c" OR "growth equity"`,
      `${topic}${geoClause} "joint venture" OR "strategic investment" OR "equity stake" OR "strategic partnership"`,
      `${topic}${geoClause} "seed round" OR "venture capital" OR "backs" OR "secures funding"`,
    ]
  })

  // Local-language queries — no geo clause; locale params handle geography
  const locales = LOCALE_MAP[geography] ?? []
  const localTopics = expansion ? expandedTerms.topics.slice(0, 3) : [rawQuery]
  const localQueries: Array<{ query: string; locale: { hl: string; gl: string; ceid: string } }> =
    locales.flatMap(locale => localTopics.flatMap(topic => [
      { query: `${topic} acquisition OR merger OR funding`, locale },
      { query: `${topic} investment OR stake OR "series"`, locale },
    ]))

  // Fetch English and local-language results in parallel
  const [englishBatches, localBatches] = await Promise.all([
    Promise.all(englishQueries.map(eq => fetchNewsItems(eq))),
    Promise.all(localQueries.map(({ query, locale }) => fetchNewsItems(query, locale))),
  ])

  const seenUrls = new Set<string>()
  const rawItems: NewsItem[] = []

  // Process English batches — apply geo cross-contamination + topic filters immediately
  for (const batch of englishBatches) {
    for (const item of batch) {
      if (seenUrls.has(item.url) || item.pub < cutoff365) continue
      if (geoAliases) {
        const t = item.title.toLowerCase()
        const hasGeo = geoAliases.some(a => t.includes(a))
        const otherGeos = ['india', 'china', 'uk', 'germany', 'france', 'australia', 'singapore', 'uae', 'saudi']
          .filter(g => !geoAliases.includes(g))
        const hasOtherGeo = otherGeos.some(g => t.includes(g))
        if (hasOtherGeo && !hasGeo) continue
      }
      if (!expandedTerms.topics.some(topic => isTopicRelevant(item.title, topic))) continue
      seenUrls.add(item.url)
      rawItems.push(item)
    }
  }

  // Process local batches — defer filtering until after translation
  for (const batch of localBatches) {
    for (const item of batch) {
      if (seenUrls.has(item.url) || item.pub < cutoff365) continue
      item.isLocal = true
      seenUrls.add(item.url)
      rawItems.push(item)
    }
  }

  // Translate all local titles in one Gemini batch call, then filter
  await translateTitles(rawItems)
  const filteredItems = rawItems.filter(item =>
    !item.isLocal || expandedTerms.topics.some(topic => isTopicRelevant(item.title, topic))
  )

  // Deduplicate same story reported by multiple outlets (≥4 shared content words)
  const items = deduplicateByContent(filteredItems)
  const sorted = [...items].sort((a, b) => b.pub.getTime() - a.pub.getTime())
  const dealItems = sorted.filter(item =>
    isDealArticle(item.title, geography, rawQuery, item.isLocal, item.url, expandedTerms.topics, geoAliases ?? undefined)
  )
  const relevanceMap = await assessRelevanceBatch(
    dealItems.map(item => ({ title: item.title, url: item.url })),
    thesis ?? rawQuery,
    expansion?.sector ?? 'Other',
    geography,
    rawQuery,
  )
  const relevantDealItems = dealItems.filter(item => {
    const match = relevanceMap.get(item.url) ?? relevanceMap.get(item.title)
    if (!match) return true
    return match.is_sector_match && match.is_geography_match && match.confidence >= 0.58
  })

  const monthMap = new Map<string, number>()
  let count30d = 0
  let count90d = 0
  let countPrior90d = 0

  for (const item of relevantDealItems) {
    const d = item.pub
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
    if (item.pub >= cutoff90) count90d++
    else if (item.pub >= cutoff180) countPrior90d++
    if (item.pub >= cutoff30) count30d++
  }

  const now = new Date()
  const chartData = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    chartData.push({
      month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      deal_count: monthMap.get(key) ?? 0,
      partial: i === 11 || i === 0,
    })
  }

  // Evidence links: geo + topic filtered; local items skip the geo-alias-in-title check
  const evidenceItems = relevantDealItems
    .slice(0, 5)
    .map(item => ({
      title: item.title,
      url: item.url,
      published_date: item.published_date,
      source: item.source,
      isTranslated: !!item.originalTitle,
    }))

  // Synthesis context: all items for Gemini to reason from (includes translated local articles)
  const synthesisItems = relevantDealItems.slice(0, 15).map(({ pub: _, isLocal: __, originalTitle: ___, ...rest }) => rest)
  const buyerItems = relevantDealItems
    .filter(item => item.pub >= cutoff90)
    .map(item => ({ title: item.title }))
  const dealTapeItems = relevantDealItems.map(item => ({
    title: item.title,
    url: item.url,
    published_date: item.published_date,
    source: item.source,
  }))

  return {
    chartData,
    dealTapeItems,
    evidenceItems,
    synthesisItems,
    buyerItems,
    count30d,
    count90d,
    countPrior90d,
    count365d: dealItems.length,
  }
}

// ── Step 3: Media mention count ────────────────────────────────────────────────

const HEADLINE_KEYWORDS_GLOBAL = [
  // Deal activity
  'acquires', 'acquisition', 'raises', 'funding',
  'investment', 'stake', 'merger', 'buyout', 'expands',
  'expansion', 'joint venture', 'capital', 'ipo',
  'valuation', 'series', 'round', 'deal', 'backed',
  'launches', 'enters', 'market entry', 'partnership',
  'invested', 'closed', 'transaction', 'buys', 'sells',
  'sale', 'purchase', 'offer', 'bid', 'agreed',
  // Corporate structure
  'spins off', 'spin-off', 'divests', 'divestiture',
  'carve-out', 'demerger', 'restructures', 'consolidates',
  'takeover', 'acqui-hire', 'strategic review',
  'goes private', 'take private', 'management buyout',
  'leveraged buyout', 'recapitalisation',
  // Finance language — global
  'private equity', 'venture capital', 'angel',
  'seed round', 'pre-ipo', 'growth equity',
  'sovereign wealth', 'family office', 'hedge fund',
  'asset management', 'fund raises', 'fund closes',
  'listed', 'delisted', 'stock exchange',
  'public offering', 'secondary offering',
  // Growth signals
  'franchises', 'licences', 'scales', 'new facility',
  'plant', 'factory', 'manufacturing unit',
  'distribution agreement', 'supply agreement',
  'capacity expansion', 'greenfield', 'brownfield',
  // Distress signals
  'insolvency', 'liquidation', 'administration',
  'debt restructuring', 'defaults', 'write-off',
  'resolution', 'stressed asset', 'receivership',
  'bankruptcy', 'chapter 11', 'creditor',
  // Market entry — global
  'enters market', 'market entry', 'sets up',
  'establishes', 'opens operations', 'expands into',
  'launches in', 'debut',
  // Regulatory and institutional — global
  'antitrust', 'regulatory approval', 'clearance',
  'government backed', 'state owned', 'sovereign',
  'competition authority', 'approved by',
]

const HEADLINE_KEYWORDS_INDIA = [
  'crore', 'lakh', 'sebi', 'nse', 'bse',
  'qip', 'ncd', 'rights issue', 'promoter stake',
  'nclt', 'dpiit', 'cci', 'pli scheme',
  'fdi approval',
]

async function getMediaMentionCount(rawQuery: string, geography: string, sector = 'Other', thesis?: string): Promise<{
  score: number
  score30d: number
  uniqueSources: number
  sourceNames: string[]
  headlines: string[]
}> {
  const HEADLINE_KEYWORDS = geography === 'India'
    ? [...HEADLINE_KEYWORDS_GLOBAL, ...HEADLINE_KEYWORDS_INDIA]
    : HEADLINE_KEYWORDS_GLOBAL

  try {
    const parser = new Parser({ timeout: 5000 })
    const query = encodeURIComponent(`${rawQuery} M&A acquisition investment`)
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
    const feed = await parser.parseURL(url)
    const cutoff = nDaysAgo(90)
    const cutoff30 = nDaysAgo(30)
    const eligibleItems = feed.items.filter(item => !!item.link && new Date(item.pubDate ?? 0) >= cutoff)
    const relevanceMap = await assessRelevanceBatch(
      eligibleItems.map(item => ({ title: item.title ?? '', url: item.link ?? item.guid ?? item.title ?? '' })),
      thesis ?? rawQuery,
      sector,
      geography,
      rawQuery,
    )

    const relevantItems = eligibleItems.filter(item => {
      const key = item.link ?? item.guid ?? item.title ?? ''
      const match = relevanceMap.get(key) ?? relevanceMap.get(item.title ?? '')
      if (!match) return true
      return match.is_sector_match && match.is_geography_match && match.confidence >= 0.58
    })

    // Google News RSS links all route through news.google.com — use item.creator
    // (publisher name) for deduplication; fall back to domain only if unavailable
    const sources = new Set<string>()
    const sources30d = new Set<string>()
    let score = 0
    let score30d = 0
    for (const item of relevantItems) {
      const sourceKey = resolveSourceName(item.creator, item.title ?? '', item.link ?? '')
      if (sourceKey) sources.add(sourceKey)
      score += 1
      if (new Date(item.pubDate ?? 0) >= cutoff30) {
        if (sourceKey) sources30d.add(sourceKey)
        score30d += 1
      }
    }
    const uniqueSources = sources.size

    // Collect up to 10 financially-relevant headlines, fully case-insensitive
    const headlines = relevantItems
      .filter(item => {
        const text = ((item.title ?? '') + ' ' + (item.contentSnippet ?? '')).toLowerCase()
        return HEADLINE_KEYWORDS.some(k => text.includes(k.toLowerCase()))
      })
      .slice(0, 10)
      .map(item => item.title ?? '')
      .filter(Boolean)

    return { score, score30d, uniqueSources, sourceNames: Array.from(sources), headlines }
  } catch {
    return { score: 0, score30d: 0, uniqueSources: 0, sourceNames: [], headlines: [] }
  }
}

// ── Step 4: Maturity-aware consensus score ─────────────────────────────────────

function calculateConsensusScore(
  dealCount90d: number,
  dealCount30d: number,
  mediaCount90d: number,
  maturity: Maturity,
) {
  // Velocity: how fast deals are arriving now vs the prior 60 days
  // > 1 = accelerating, < 1 = decelerating
  const priorRate = Math.max((dealCount90d - dealCount30d) / 60, 0.05)
  const velocityRatio = (dealCount30d / 30) / priorRate
  const accelerating = velocityRatio >= 1.5
  if (maturity === 'MATURE') {
    // For established sectors, the frame is entirely different.
    // Low volume ≠ undiscovered opportunity. It means steady-state or cooling.
    if (dealCount90d >= 5 && mediaCount90d >= dealCount90d * 0.5) {
      return {
        state: 'ACTIVE',
        colour: 'orange',
        explanation: 'Deal flow is running at a healthy pace for a mature sector. Competition for assets is real — pricing reflects that.',
      }
    } else if (dealCount90d >= 2) {
      return {
        state: 'ESTABLISHED',
        colour: 'green',
        explanation: 'A well-established sector with steady deal activity. The market is known and priced — edge comes from execution and relationships, not discovery.',
      }
    } else if (mediaCount90d >= 5) {
      return {
        state: 'NARRATIVE',
        colour: 'red',
        explanation: 'More commentary than transactions right now. The sector is well-understood but deal activity is below the level media interest would suggest.',
      }
    } else {
      return {
        state: 'ESTABLISHED',
        colour: 'grey',
        explanation: 'A mature sector with too little recent deal evidence to call cooling without a documented prior peak.',
      }
    }
  }

  // EMERGING or NASCENT: velocity-weighted signal logic
  if (dealCount90d >= 3 && dealCount90d > mediaCount90d * 1.5) {
    return {
      state: 'EARLY SIGNAL',
      colour: 'green',
      explanation: accelerating
        ? "Deal activity is outpacing media coverage and accelerating — capital is moving faster than the narrative has caught up."
        : "Deal activity in this space is outpacing media coverage — this theme hasn't fully entered the mainstream narrative yet.",
    }
  } else if (dealCount90d >= 3 && mediaCount90d >= dealCount90d * 0.8) {
    return {
      state: 'CONSENSUS',
      colour: 'yellow',
      explanation: accelerating
        ? 'A well-tracked theme that is re-accelerating — deal flow is picking up even as the narrative is already mainstream.'
        : 'This theme has broad market and media attention — the narrative is well-formed and most participants are already aware.',
    }
  } else if (dealCount90d < 3 && mediaCount90d >= 5) {
    return {
      state: 'HYPE',
      colour: 'red',
      explanation: 'Media coverage is running well ahead of actual deal activity — interest is outpacing real capital deployment.',
    }
  } else if (accelerating && dealCount90d >= 1) {
    return {
      state: 'EARLY SIGNAL',
      colour: 'green',
      explanation: 'Deal count is low in absolute terms but the recent rate is accelerating sharply — worth watching for confirmation.',
    }
  } else {
    return {
      state: 'QUIET',
      colour: 'grey',
      explanation: 'Limited deal activity and media coverage — either very early stage or not yet an active theme.',
    }
  }
}

// ── Step 4b: Thematic stage ────────────────────────────────────────────────────

type ThematicStage = 'Exploratory' | 'Emerging' | 'Consensus' | 'Crowded' | 'Exhausted' | 'Insufficient data'

function calculateThematicStage(
  consensusState: string,
  count90d: number,
  mediaCount90d: number,
  hasPriorPeak: boolean,
): { stage: ThematicStage; meaning: string } {
  if (count90d < SIGNAL_THRESHOLDS.MIN_DEALS_FOR_STAGE) {
    return { stage: 'Insufficient data', meaning: 'Not enough tracked data to place this thesis.' }
  }
  if ((consensusState === 'COOLING' || consensusState === 'NARRATIVE') && hasPriorPeak) {
    return { stage: 'Exhausted', meaning: 'Narrative is detaching from capital — the theme has peaked and is repricing.' }
  }
  if (consensusState === 'HYPE' || (mediaCount90d > count90d * 2.5 && count90d > 2)) {
    return { stage: 'Crowded', meaning: 'Media saturation is outrunning transaction evidence — narrative has gotten ahead of reality.' }
  }
  if (consensusState === 'CONSENSUS' || consensusState === 'ACTIVE' || consensusState === 'ESTABLISHED') {
    return { stage: 'Consensus', meaning: 'Theme is widely recognised. Most active participants already see it.' }
  }
  if (consensusState === 'EARLY SIGNAL') {
    return { stage: 'Emerging', meaning: 'Capital is moving before consensus has formed — consistent with early institutional positioning.' }
  }
  return { stage: 'Emerging', meaning: 'Early-stage activity with limited confirmation.' }
}

// ── Step 4c: Narrative velocity ────────────────────────────────────────────────

type NarrativeVelocityLabel = 'Accelerating' | 'Steady' | 'Slowing' | 'Peaked' | 'Absent'

function calculateNarrativeVelocity(media30d: number, media90d: number): {
  ratio: number
  label: NarrativeVelocityLabel
  description: string
} {
  if (media90d < 3) {
    return { ratio: 0, label: 'Absent', description: 'No narrative visible yet — either pre-coverage or not a named theme.' }
  }
  const prior60dRate = Math.max((media90d - media30d) / 60, 0.1)
  const recent30dRate = media30d / 30
  const ratio = recent30dRate / prior60dRate

  if (ratio >= 1.8) return { ratio, label: 'Accelerating', description: 'Coverage rate in the last 30 days is significantly above the prior 60-day pace — consensus is forming fast.' }
  if (ratio >= 0.7) return { ratio, label: 'Steady', description: 'Narrative forming at a consistent rate — no sharp acceleration or deceleration visible.' }
  if (ratio >= 0.3) return { ratio, label: 'Slowing', description: 'Coverage growth is tapering from a higher base — narrative formation is decelerating.' }
  return { ratio, label: 'Peaked', description: 'Coverage rate has dropped sharply — the narrative may have already peaked ahead of capital deployment.' }
}

// ── Step 5: Gemini thesis ──────────────────────────────────────────────────────

type SignalAssessment = {
  verdict: string
  badge: string
  confidence: number
  displayNote: string | null
  showRawVerdict: boolean
}

function calculateSignalAssessment(params: {
  rawVerdict: string
  sourceCount: number
  dataVolume: number
  signalClarityScore: number
}): SignalAssessment {
  const signalClarity = Math.max(0, Math.min(1, params.signalClarityScore / 100))
  const confidence = Math.round((
    (params.sourceCount >= 5 ? 1 : params.sourceCount / 5) * 0.4 +
    (params.dataVolume >= 20 ? 1 : params.dataVolume / 20) * 0.3 +
    signalClarity * 0.3
  ) * 100) / 100

  // Confidence is now purely a graded label on top of the real read — it
  // never replaces or hides the verdict. A thin sample means "treat this
  // directionally," not "we have nothing to tell you." The thesis writer
  // is told to write honestly around thin data,
  // so the gate's only job here is to set expectations, not suppress output.
  if (confidence < 0.2) {
    return {
      verdict: params.rawVerdict,
      badge: 'EARLY READ',
      confidence,
      displayNote: `Based on ${params.sourceCount} source(s) and ${params.dataVolume} tracked item(s) — thin enough that this is a directional lead, not a settled call. Read the analysis below for the structural reasoning behind it.`,
      showRawVerdict: true,
    }
  }

  if (confidence < 0.6) {
    return {
      verdict: params.rawVerdict,
      badge: 'DIRECTIONAL',
      confidence,
      displayNote: `Based on ${params.sourceCount} sources and ${params.dataVolume} tracked items. Directionally useful, not yet statistically robust.`,
      showRawVerdict: true,
    }
  }

  return {
    verdict: params.rawVerdict,
    badge: confidence > 0.8 ? 'HIGH CONFIDENCE' : 'MODERATE CONFIDENCE',
    confidence,
    displayNote: null,
    showRawVerdict: true,
  }
}

// ── Step 5b: Premia Read ───────────────────────────────────────────────────────

async function generatePremiaRead(params: {
  userInput: string
  sector: string
  geography: string
  consensusState: string
  signalAssessment: SignalAssessment
  thematicStage: ThematicStage
  narrativeVelocityLabel: NarrativeVelocityLabel
  count90d: number
  mediaCount90d: number
  sourceCount: number
  dataVolume: number
  signalClarityScore: number
  velocityRatio: number
  maturity: Maturity
  signalTier: string
  confidencePercent: number
}): Promise<string> {
  const prompt = `Write a "Premia Read" — a one-paragraph house view for an institutional reader who will act on this in the next 48 hours.

This is NOT a summary of the data. It is an interpretation. Answer the question that matters: given these signals, what is actually happening here, and what does it tell someone trying to understand the state of this theme?

Start with a concise sector view grounded in background knowledge. End with exactly one coverage caveat sentence. Thin tracked data lowers confidence only; it never removes sector context.

You must answer at least two of these (the ones the data speaks to):
- Is capital moving before narrative, or is narrative outpacing capital?
- Is this early institutional positioning or late-stage consensus crowding?
- Is the theme structurally durable or temporarily fashionable?
- Is sparse data here informative — and in which direction?
- What does the narrative velocity tell us about the timing of consensus formation?

Rules:
- State one view. Do not write "one reading is X, alternatively Y"; pick the more probable reading given the data.
- State the single biggest risk to that view in one sentence.
- When signal tier is insufficient, do not make a claim about tracked activity beyond the supplied counts. Start with: "Here is the sector landscape. Our tracked sources show limited deal activity, so we are not calling a stage."
- If signal tier is partial, use hedged language like "early data suggests" or "so far".
- Always summarize the sector context first, then state the data-coverage caveat in the final sentence.
- Never let a confidence caveat coexist with a strong claim. If the caveat is true, downgrade the claim to match it.
- Absence of tracked deals is a coverage limitation, not evidence of low market activity; never infer disinterest, a frozen market, or a concluded cycle from sparse data.
- Cite the actual sourcing gap when relevant. If source coverage is thin, say "our narrative-tracking coverage is thin here" rather than implying a market-level information asymmetry.
- Maximum 120 words.
- Take a definitive stance. No vague neutrality.
- Probabilistic where genuine uncertainty exists, but do not hide behind uncertainty.
- No recommendations ("investors should", "this represents an opportunity").
- Banned phrases: "it is worth noting", "it is important to consider", "robust", "landscape", "ecosystem", "transformative", "stakeholders", "well-positioned", "it remains to be seen", "this underscores", "this highlights".
- 2–4 sentences. One idea per sentence. Present tense. Strong nouns.

Data:
- Thesis: ${params.userInput}
- Sector: ${params.sector}
- Geography: ${params.geography}
- Signal: ${params.consensusState}
- Confidence badge: ${params.signalAssessment.badge}
- Composite confidence: ${params.signalAssessment.confidence}
- Thematic stage: ${params.thematicStage}
- Narrative velocity: ${params.narrativeVelocityLabel}
- Deals (90d): ${params.count90d} · Media mentions (90d): ${params.mediaCount90d}
- Independent sources tracked: ${params.sourceCount}
- Tracked items: ${params.dataVolume}
- Signal clarity: ${params.signalClarityScore}/100
- Capital-to-narrative ratio: ${params.velocityRatio.toFixed(2)}x
- Sector maturity: ${params.maturity}
- Signal tier: ${params.signalTier}
- Confidence percent: ${params.confidencePercent}%

Return only one paragraph. No headers, no labels, no preamble.`

  try {
    const text = (await timed('premia_read', () => generateContent(prompt, MODELS.premiaRead, 'premia_read'))).trim()
    if (text.length > 60 && !(params.signalTier === 'insufficient' && /disinterest|frozen|concluded cycle|\bcooling\b|\bexhausted\b|\bquiet\b/i.test(text))) return text
    throw new Error('Too short')
  } catch {
    const fallbacks: Record<ThematicStage, string> = {
      'Exploratory': `The sample is too thin to call institutional positioning: ${params.count90d} deals, ${params.mediaCount90d} media mentions, and ${params.sourceCount} source(s) tracked. Risk: our coverage may be missing local or private-market activity.`,
      'Emerging': `Deal activity is ahead of tracked media, but the read is directional at ${params.sourceCount} sources and ${params.dataVolume} tracked items. Risk: the gap may reflect our narrative-tracking coverage rather than a true market information edge.`,
      'Consensus': 'The theme is widely understood and priced into the attention of most active participants. Information asymmetry is limited — edge comes from depth of analysis within the theme, not from discovering it.',
      'Crowded': 'Narrative has outrun capital deployment at a significant margin. The gap between coverage and confirmed transactions suggests saturation rather than undiscovered signal.',
      'Exhausted': 'Activity is declining in a context where narrative is still present. The theme appears to be repricing from peak enthusiasm — capital is not following the commentary.',
      'Insufficient data': `Here is the sector landscape. Our tracked sources show limited deal activity, so we are not calling a stage. Background knowledge frames ${params.sector} in ${params.geography} through local buyers, regulators and funding routes; named participants and rules are unverified. Our ${params.count90d}-deal, ${params.mediaCount90d}-mention sample from ${params.sourceCount} source${params.sourceCount === 1 ? '' : 's'} cannot support a stage call.`,
    }
    return fallbacks[params.thematicStage]
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

// Resolves to undefined after ms, and never rejects, so a slow or failed side task cannot fail the analysis.
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p.catch(() => undefined), new Promise<undefined>(resolve => { t = setTimeout(() => resolve(undefined), ms) })])
  } finally {
    if (t) clearTimeout(t)
  }
}

export async function POST(req: NextRequest) {
  const timer = new StageTimer()
  try {
    return await runWithTimer(timer, () => handleAnalyse(req))
  } finally {
    console.log('[analyse-timing]', JSON.stringify(timer.summary()))
  }
}

async function handleAnalyse(req: NextRequest) {
  try {
    const { thesis, skipThesis } = await req.json()
    if (!thesis?.trim()) {
      return NextResponse.json({ error: 'thesis is required' }, { status: 400 })
    }

    // Step 1: parse thesis
    let sector = 'Other', geography = 'Other', raw_query = thesis
    try {
      const parsed = await parseThesis(thesis)
      sector = parsed.sector
      geography = parsed.geography
      raw_query = parsed.raw_query
    } catch {
      raw_query = thesis.slice(0, 60)
    }
    if (sector === 'Other' && /\b(defen[cs]e|aerospace)\b/i.test(thesis)) {
      sector = 'Defence & Aerospace'
    } else if (sector === 'Other' && /\b(financial services|banking|wealth management|payments|asset management|insurance)\b/i.test(thesis)) {
      sector = 'Financial Services'
    }
    if (geography === 'Other' && /\b(dubai|uae|abu dhabi|gcc)\b/i.test(thesis)) {
      geography = 'Middle East'
    }
    const explicitUaeCity = /\bdubai\b/i.test(thesis)
      ? 'Dubai, UAE'
      : /\babu dhabi\b/i.test(thesis) ? 'Abu Dhabi, UAE' : null
    const reportGeography = explicitUaeCity ?? (geography === 'Other' ? 'Global (no geography specified)' : geography)
    const benchmarkGeography = explicitUaeCity
      ? 'UAE'
      : geography === 'Other' ? 'Global' : geography

    // Steps 1b + role-separated stored signal data + market context in parallel
    // The research prefetch is awaited (own 15 s cap, errors swallowed) so its cache write finishes before the response ends.
    const [maturityResult, storedSignalData, fallbackDealData, fallbackMediaData, marketContext] = await Promise.all([
      timed('maturity_total', () => classifyMaturity(thesis, sector, geography)),
      timed('stored_data', () => getStoredSignalData(sector, geography, raw_query)),
      timed('deal_fetch', () => getDealData(geography, raw_query, undefined, thesis)),
      timed('media_count', () => getMediaMentionCount(raw_query, geography, sector, thesis)),
      timed('market_context', () => getMarketContext(sector, benchmarkGeography, raw_query)),
      skipThesis === true ? timed('research_prefetch', () => withTimeout(prefetchSectorResearch(sector, reportGeography), 15_000)) : Promise.resolve(undefined),
    ]).then(r => r.slice(0, 5) as [Awaited<ReturnType<typeof classifyMaturity>>, Awaited<ReturnType<typeof getStoredSignalData>>, Awaited<ReturnType<typeof getDealData>>, Awaited<ReturnType<typeof getMediaMentionCount>>, Awaited<ReturnType<typeof getMarketContext>>])
    let dealData = storedSignalData?.dealData ?? fallbackDealData
    let expansionDescription: string | null = null
    const initialSourceNames = storedSignalData?.confidenceMetadata.source_names ??
      [
        ...(dealData.synthesisItems as { source?: string }[]).flatMap(item => (item.source ?? '').split(',').map(source => source.trim()).filter(Boolean)),
        ...(storedSignalData?.mediaData.sourceNames ?? fallbackMediaData.sourceNames),
      ]
    const initialSourceCount = new Set(initialSourceNames).size
    if (dealData.count90d < SIGNAL_THRESHOLDS.MIN_DEALS_FOR_STAGE || initialSourceCount < SIGNAL_THRESHOLDS.MIN_SOURCES_FOR_STAGE) {
      const expandedDealData = await timed('expansion_rerun', () => getDealData(geography, raw_query, { sector }, thesis))
      expansionDescription = geography === 'Middle East'
        ? `Expanded sector terms and geography from ${geography} to Dubai, UAE and GCC; checked a 12-month window.`
        : geography === 'Other'
          ? 'Expanded sector terms and ran multiple global-query variants; checked a 12-month window.'
          : `Expanded sector terms for ${geography}; checked a 12-month window.`
      if (
        expandedDealData.count90d > dealData.count90d ||
        (expandedDealData.count90d === dealData.count90d && expandedDealData.count365d > dealData.count365d)
      ) {
        dealData = expandedDealData
      }
    }
    const { chartData, dealTapeItems, evidenceItems, synthesisItems, buyerItems, count30d, count90d, countPrior90d, count365d } = dealData
    const {
      score: mediaCount90d,
      score30d: mediaCount30d,
      uniqueSources: mediaUniqueSources,
      sourceNames: mediaSourceNames,
      headlines: newsHeadlines,
    } = storedSignalData?.mediaData ?? fallbackMediaData
    const confidenceMetadata = storedSignalData?.confidenceMetadata ?? {
      distinct_deal_source_count: new Set(
        (synthesisItems as { source?: string }[]).flatMap(item => (item.source ?? '').split(',').map(source => source.trim()).filter(Boolean))
      ).size,
      distinct_narrative_source_count: mediaUniqueSources,
      source_names: [
        ...(synthesisItems as { source?: string }[]).flatMap(item => (item.source ?? '').split(',').map(source => source.trim()).filter(Boolean)),
        ...mediaSourceNames,
      ],
      feed_health_summary: [],
    }


    // Step 4
    let consensus = calculateConsensusScore(count90d, count30d, mediaCount90d, maturityResult.maturity)
    const priorRate = Math.max((count90d - count30d) / 60, 0.05)
    const velocityRatio = (count30d / 30) / priorRate
    let thematicStage = calculateThematicStage(consensus.state, count90d, mediaCount90d, false)
    const narrativeVelocity = calculateNarrativeVelocity(mediaCount30d, mediaCount90d)

    // Additional signal metrics and lightweight buyer composition heuristics.
    // Keep the buyer panel aligned to a consistent 90-day signal window and never
    // imply a buyer type when the transaction record is silent.
    const classifyBuyerFromTitle = (title: string) => {
      const t = title.toLowerCase()
      if (/sovereign wealth|sovereign fund|swf|state owned|government-backed|state-backed/.test(t)) return 'SWF'
      if (/private equity|pe firm|buyout|buyout firm|buyout fund|leveraged buyout|lbo|take private|buyout sponsor/.test(t)) return 'Private Equity'
      if (/series [abcedf]|seed round|venture capital|vc firm|angel investor|venture-backed|raised|growth equity|series\s+[a-z]+/.test(t)) return 'VC'
      if (/acquir|acquired by|acquires|acquisition|merger|takeover|strategic acquisition|strategic buyer|signed acquisition|purchase of/.test(t)) return 'Strategic'
      return 'Undisclosed / unclassified'
    }

    const buyerCounts: Record<string, number> = {
      Strategic: 0,
      'Private Equity': 0,
      VC: 0,
      SWF: 0,
      'Undisclosed / unclassified': 0,
    }
    for (const item of buyerItems) {
      const cls = classifyBuyerFromTitle(item.title)
      buyerCounts[cls] = (buyerCounts[cls] ?? 0) + 1
    }
    const totalBuyerSignals = Object.values(buyerCounts).reduce((s, v) => s + v, 0)
    const buyerPercentages = toPercentages(Object.values(buyerCounts))
    const buyerComposition = Object.fromEntries(
      Object.keys(buyerCounts).map((key, i) => [key, buyerPercentages[i]])
    )

    // Premia score: weighted combination of normalized volume, recency, source breadth, and clarity
    const norm = (v: number, max = 50) => Math.min(100, Math.round((v / max) * 100))
    const dataVolumeScore = norm(count90d, 30)
    const recencyScore = norm(count30d, 12)
    const sourceBreadthScore = Math.min(100, Math.round((mediaUniqueSources / 20) * 100))
    const signalClarityScore = Math.max(10, Math.min(95, 80 - Math.abs((count90d - mediaCount90d)) * 4))
    const premiaScore = Math.round((dataVolumeScore * 0.3) + (recencyScore * 0.25) + (sourceBreadthScore * 0.2) + (signalClarityScore * 0.25))
    const sourceNames = new Set((confidenceMetadata.source_names ?? []).map(source => source.trim()).filter(Boolean))
    const sourceCount = sourceNames.size
    const dataVolume = count90d + mediaCount90d
    const baseSignalAssessment = calculateSignalAssessment({
      rawVerdict: consensus.state,
      sourceCount,
      dataVolume,
      signalClarityScore,
    })
    const activeMonths = activeMonthsInWindow(chartData, 3)
    const baseConfidencePercent = Math.round(baseSignalAssessment.confidence * 100)
    const signalTier = getSignalTier({ deals90d: count90d, sourceCount, activeMonths, confidence: baseConfidencePercent })
    const signalAssessment: SignalAssessment = signalTier === 'insufficient'
      ? {
          verdict: 'INSUFFICIENT DATA',
          badge: 'Low (coverage-limited)',
          confidence: Math.min(baseSignalAssessment.confidence, 0.29),
          displayNote: 'Tracked deal coverage is below the minimum for a stage call; sector context remains available.',
          showRawVerdict: false,
        }
      : baseSignalAssessment
    const confidencePercent = Math.round(signalAssessment.confidence * 100)
    const lowDataMode = signalTier === 'insufficient'
    if (lowDataMode) {
      consensus = {
        state: 'INSUFFICIENT DATA',
        colour: 'grey',
        explanation: 'The tracked set is below the configured minimum for a market-stage call.',
      }
    }
    const momentum = calculateMomentum(count90d, countPrior90d ?? 0)
    const dealMomentumPct = momentum == null ? null : Math.round(momentum * 100)
    const priorPeak = hasDocumentedPriorPeak(chartData, count90d, SIGNAL_THRESHOLDS.MIN_DEALS_FOR_STAGE)
    const showSignalGap = !lowDataMode && shouldShowSignalGap(mediaCount90d, count90d)
    const showDealTrend = signalTier !== 'insufficient' && shouldShowDealTrend(chartData)
    thematicStage = signalTier === 'insufficient'
      ? { stage: 'Insufficient data', meaning: 'Not enough tracked data to place this thesis.' }
      : calculateThematicStage(consensus.state, count90d, mediaCount90d, priorPeak)

    // Narrative velocity numeric (0-100) from ratio (map 0..3+ to 0..100)
    const nvRatio = narrativeVelocity.ratio || 0
    const narrativeVelocityScore = Math.max(0, Math.min(100, Math.round((Math.min(nvRatio, 3) / 3) * 100)))

    // Confidence band derived from data volume (used for signal strength)
    const confidence: 'high' | 'medium' | 'low' =
      count90d >= 20 ? 'high' : count90d >= 7 ? 'medium' : 'low'

    // Signal strength label derived from confidence + clarity
    const signalStrength = ((): 'Weak' | 'Moderate' | 'Dense' => {
      const clarity = signalClarityScore
      if (confidence === 'high' || (clarity >= 65 && premiaScore >= 60)) return 'Dense'
      if (clarity >= 40 || premiaScore >= 45) return 'Moderate'
      return 'Weak'
    })()

    // Why bullets: 3–5 short, data-derived lines
    const whyBullets: string[] = []
    whyBullets.push(`${count90d} transactions in last 90 days`)
    if (showSignalGap && count90d > mediaCount90d) whyBullets.push('Deal activity exceeds media activity')
    else if (showSignalGap && mediaCount90d > count90d) whyBullets.push('Media attention exceeds confirmed transactions')
    if (count30d > 0) {
      whyBullets.push(count90d < 10
        ? `Recent activity: ${count30d} of ${count90d} tracked item(s) occurred in the last 30 days`
        : dealMomentumPct == null
          ? 'Deal momentum needs a prior period'
          : `Deal momentum: ${dealMomentumPct >= 0 ? `+${dealMomentumPct}%` : `${dealMomentumPct}%`} vs prior`
      )
    }
    // dominant buyer type
    const dominantBuyer = Object.entries(buyerComposition).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (dominantBuyer && Number(dominantBuyer[1]) > 40) {
      const dominantBuyerCount = buyerCounts[dominantBuyer[0]] ?? 0
      whyBullets.push(totalBuyerSignals < 10
        ? `${dominantBuyer[0]} buyers appear in ${dominantBuyerCount} of ${totalBuyerSignals} observed signal(s)`
        : `${dominantBuyer[0]} buyers dominate recent activity (${dominantBuyer[1]}%)`
      )
    }
    // trim to 3-5
    while (whyBullets.length > 5) whyBullets.pop()

    // Key insights: three short bullets (max 15 words)
    const standout: string[] = []
    // Unusual: high deal/media gap
    if (!lowDataMode && Math.abs(count90d - mediaCount90d) >= Math.max(3, Math.round(0.4 * Math.max(count90d, mediaCount90d)))) {
      standout.push(count90d > mediaCount90d ? `${count90d} deals vs ${mediaCount90d} mentions` : `${mediaCount90d} mentions vs ${count90d} deals`)
    }
    // concentration in last 30 days
    if (count30d >= Math.max(2, Math.round(0.4 * count90d))) standout.push(`${count30d} deals in last 30 days`) 
    // buyer dominance
    if (dominantBuyer && Number(dominantBuyer[1]) >= 50) {
      const dominantBuyerCount = buyerCounts[dominantBuyer[0]] ?? 0
      standout.push(totalBuyerSignals < 10
        ? `${dominantBuyer[0]} appears in ${dominantBuyerCount} of ${totalBuyerSignals} observed signal(s)`
        : `${dominantBuyer[0]} account for ${dominantBuyer[1]}% of signals`
      )
    }
    const threeThings = lowDataMode ? [] : standout.slice(0, 3)

    // Scenario triggers (simple rules)
    const scenarioTriggers = [
      { event: 'Media coverage triples', likelyImpact: 'Moves toward crowded' },
      { event: 'Deal volume declines sharply', likelyImpact: 'Weakens conviction' },
      { event: 'PE activity accelerates', likelyImpact: 'Changes market structure' },
      { event: 'Venture funding surges', likelyImpact: 'Increases narrative velocity' },
    ]


    // Steps 5 + premia read in parallel
    const thesisParams = {
      userInput: thesis,
      sector,
      geography: reportGeography,
      consensusState: consensus.state,
      count30d,
      count90d,
      count365d,
      mediaCount90d,
      synthesisItems,
      marketContext,
      signalTier,
      confidencePercent,
      sourceCount,
      activeMonths,
      expansionDescription,
    }
    // Without skipThesis the route returns a cheap facts-only read; the written thesis comes from /api/thesis.
    const factsOnly = skipThesis === true ? null : buildFactsOnly({
      count30d,
      count90d,
      count365d,
      mediaCount90d,
      sourceCount,
      items: synthesisItems as { title?: string; url?: string; published_date?: string; source?: string }[],
    })
    const [thesisText, premiaRead] = await Promise.all([
      Promise.resolve(factsOnly?.text ?? ''),
      generatePremiaRead({
        userInput: thesis,
        sector,
        geography: reportGeography,
        consensusState: consensus.state,
        signalAssessment,
        thematicStage: thematicStage.stage,
        narrativeVelocityLabel: narrativeVelocity.label,
        count90d,
        mediaCount90d,
        sourceCount,
        dataVolume,
        signalClarityScore,
        velocityRatio,
        maturity: maturityResult.maturity,
        signalTier,
        confidencePercent,
      }),
    ])

    return NextResponse.json({
      low_data_mode: lowDataMode,
      signal_tier: signalTier,
      signal_thresholds: SIGNAL_THRESHOLDS,
      geography,
      sector,
      consensus,
      signal_assessment: signalAssessment,
      chart_data: chartData,
      deal_tape: dealTapeItems,
      stats: {
        count_30d: count30d,
        count_90d: count90d,
        count_365d: count365d,
        count_prior_90d: countPrior90d ?? 0,
        active_months: activeMonths,
        media_sources: mediaUniqueSources,
        media_30d: mediaCount30d,
        media_mentions_90d: mediaCount90d,
        source_count: sourceCount,
        source_names: Array.from(sourceNames),
        items_tracked: dataVolume,
        data_volume: dataVolume,
        expansion_description: expansionDescription,
        distinct_deal_source_count: confidenceMetadata.distinct_deal_source_count,
        distinct_narrative_source_count: confidenceMetadata.distinct_narrative_source_count,
        feed_health_summary: confidenceMetadata.feed_health_summary,
        velocity_ratio: Math.round(velocityRatio * 100) / 100,
        signal_gap: showSignalGap ? count90d - mediaCount90d : null,
        show_signal_gap: showSignalGap,
        show_deal_trend: showDealTrend,
        confidence,
        signal_window_label: '90-day signal window',
        context_window_label: '12-month context window',
      },
      premia_read: premiaRead,
      thematic_stage: thematicStage,
      narrative_velocity: narrativeVelocity,
      thesis: thesisText,
      thesis_sources: factsOnly?.sources ?? [],
      thesis_inputs: skipThesis === true ? thesisParams : undefined,
      evidence: evidenceItems,
      market_context: marketContext,
      premia_score: lowDataMode ? confidencePercent : premiaScore,
      deal_momentum: dealMomentumPct,
      narrative_velocity_score: narrativeVelocityScore,
      signal_strength: signalStrength,
      why_bullets: whyBullets,
      buyer_composition: totalBuyerSignals > 0 ? buyerComposition : undefined,
      buyer_counts: buyerCounts,
      buyer_sample_count: totalBuyerSignals,
      three_things: threeThings,
      scenario_triggers: scenarioTriggers,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Analyse error:', message)
    return NextResponse.json({ error: 'Analysis failed', detail: message }, { status: 500 })
  }
}
