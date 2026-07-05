import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Parser from 'rss-parser'
import { getMarketContext } from '@/lib/queries/marketContext'

export const maxDuration = 60

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })
const geminiFallback = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function generateContent(prompt: string): Promise<string> {
  try {
    const result = await gemini.generateContent(prompt)
    const text = result.response.text()
    console.log('[Gemini] primary ok, chars:', text.length)
    return text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[Gemini] primary failed:', msg.slice(0, 200))
    try {
      const result = await geminiFallback.generateContent(prompt)
      const text = result.response.text()
      console.log('[Gemini] fallback ok, chars:', text.length)
      return text
    } catch (fallbackErr) {
      const fMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      console.error('[Gemini] fallback also failed:', fMsg.slice(0, 200))
      throw fallbackErr
    }
  }
}

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

  return extractJSON(await generateContent(prompt)) as {
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
    const parsed = extractJSON(await generateContent(prompt)) as { maturity: Maturity; reason: string }
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
  sector: string | null
  geography: string | null
  feed_role: 'deal_source' | 'narrative_source' | 'both' | null
  distinct_source_count: number | null
}

interface StoredFeedItemRow {
  title: string
  url: string
  source: string | null
  published_date: string | null
  snippet: string | null
  feed_role: 'deal_source' | 'narrative_source' | 'both'
  feed_region: string | null
  feed_sector: string | null
  feed_url: string | null
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
          source: item.creator ?? extractDomain(item.link ?? ''),
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

const DEAL_KEYWORDS = [
  // M&A
  'acquires', 'acquired', 'acquisition', 'takes stake', 'majority stake', 'minority stake',
  'buyout', 'take private', 'merger', 'merges', 'carve-out', 'divestiture', 'divests',
  'sale process', 'going private', 'spin-off', 'spins off',
  'buys', 'agreed to acquire', 'completes acquisition',
  // Funding & investment — specific enough to avoid false positives
  'raises $', 'raises €', 'raises £', 'funding round', 'series a', 'series b', 'series c', 'series d',
  'seed round', 'pre-seed', 'growth equity', 'venture capital', 'invested in', 'invests in',
  'secures funding', 'closes funding', 'pre-ipo', 'equity stake',
  // Strategic moves
  'joint venture', 'strategic investment', 'strategic acquisition',
  'takes equity', 'equity investment',
]

// Patterns that indicate roundups, reports, or opinion pieces — not actual deals
const NOISE_PATTERNS = [
  // Review / roundup pieces
  'year in review', 'annual report', 'outlook for', 'predictions for', 'trends in',
  'state of', 'guide to', 'introduction to', 'overview of', 'history of',
  'what is', 'how to', 'top 10', 'top 5', 'ranking', 'rankings',
  'podcast', 'webinar', 'conference', 'summit', 'award', 'awards',
  'interview', 'q&a', 'opinion:', 'column:', 'comment:',
  'weekly', 'monthly', 'quarterly review', 'market update',
  // Market research reports
  'market analysis', 'market report', 'market size', 'market share',
  'market research', 'market forecast', 'market growth', 'market study',
  'global market', 'industry report', 'industry analysis', 'industry forecast',
  'research report', 'growth report', 'future market', 'market insights',
  'cagr', 'compound annual', 'market valuation', 'market revenue',
  // Political / non-commercial context
  'anti-defection', 'defection law', 'joining a rival party', 'free speech',
  'political party', 'opposition party', 'ruling party', 'coalition government',
  'parliament', 'legislature', 'senator', 'congressman', 'member of parliament',
  'election', 're-election', 'by-election', 'ballot', 'referendum',
]

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

async function getStoredSignalData(sector: string, geography: string, rawQuery: string) {
  const cutoff365 = isoDate(nDaysAgo(365))
  const cutoff90 = isoDate(nDaysAgo(90))
  const cutoff30 = isoDate(nDaysAgo(30))
  const sectorFilter = sector !== 'Other' ? `&sector=eq.${encodeURIComponent(sector)}` : ''
  const geographyFilter = geography !== 'Other' ? `&geography=eq.${encodeURIComponent(geography)}` : ''
  const regionFilter = geography !== 'Other' ? `&feed_region=eq.${encodeURIComponent(geography)}` : ''

  try {
    const [dealRows, narrativeRows, unhealthyFeeds] = await Promise.all([
      supabaseRest<StoredDealRow[]>(
        `deals?select=title,url,source,published_date,sector,geography,feed_role,distinct_source_count&published_date=gte.${cutoff365}&${roleFilterParam('feed_role')}${sectorFilter}${geographyFilter}&order=published_date.desc&limit=500`
      ),
      supabaseRest<StoredFeedItemRow[]>(
        `feed_items?select=title,url,source,published_date,snippet,feed_role,feed_region,feed_sector,feed_url&published_date=gte.${cutoff90}&${narrativeRoleFilterParam('feed_role')}${regionFilter}&order=published_date.desc&limit=500`
      ),
      supabaseRest<FeedHealthRow[]>(
        `feed_health?select=feed_url,consecutive_failures,region,sector,feed_role&consecutive_failures=gte.3${geography !== 'Other' ? `&or=(region.eq.${encodeURIComponent(geography)},region.is.null)` : ''}`
      ),
    ])

    const relevantNarrative = narrativeRows.filter(item =>
      (sector === 'Other' || !item.feed_sector || item.feed_sector === sector || titleMatchesQuery(item.title, item.snippet, rawQuery)) &&
      titleMatchesQuery(item.title, item.snippet, rawQuery)
    )

    if (dealRows.length === 0 && relevantNarrative.length === 0) return null

    const monthMap = new Map<string, number>()
    let count30d = 0
    let count90d = 0
    for (const row of dealRows) {
      if (!row.published_date) continue
      const d = new Date(row.published_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
      if (row.published_date >= cutoff90) count90d++
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
      })
    }

    const narrativeSources = new Set(relevantNarrative.map(item => item.source?.trim()).filter(Boolean))
    const narrativeSources30d = new Set(
      relevantNarrative
        .filter(item => item.published_date && item.published_date >= cutoff30)
        .map(item => item.source?.trim())
        .filter(Boolean)
    )
    const dealSources = new Set(
      dealRows.flatMap(item => (item.source ?? '').split(',').map(source => source.trim()).filter(Boolean))
    )
    const mediaCount90d = narrativeSources.size
    const mediaCount30d = narrativeSources30d.size

    return {
      dealData: {
        chartData,
        count30d,
        count90d,
        evidenceItems: dealRows.slice(0, 5).map(item => ({
          title: item.title,
          url: item.url,
          published_date: item.published_date ?? '',
          source: item.source ?? '',
        })),
        synthesisItems: dealRows.slice(0, 15).map(item => ({
          title: item.title,
          url: item.url,
          published_date: item.published_date ?? '',
          source: item.source ?? '',
        })),
      },
      mediaData: {
        score: mediaCount90d,
        score30d: mediaCount30d,
        uniqueSources: mediaCount90d,
        headlines: relevantNarrative.slice(0, 10).map(item => item.title),
      },
      confidenceMetadata: {
        distinct_deal_source_count: dealSources.size,
        distinct_narrative_source_count: narrativeSources.size,
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

const GEO_ALIASES: Record<string, string[]> = {
  'United States': ['us', 'u.s.', 'united states', 'america', 'american'],
  'India': ['india', 'indian'],
  'United Kingdom': ['uk', 'u.k.', 'britain', 'british', 'england'],
  'Germany': ['germany', 'german'],
  'France': ['france', 'french'],
  'Southeast Asia': ['southeast asia', 'sea', 'asean', 'singapore', 'indonesia', 'thailand', 'vietnam', 'malaysia', 'philippines'],
  'Middle East': ['middle east', 'mena', 'gulf', 'uae', 'saudi', 'qatar', 'kuwait', 'bahrain', 'oman'],
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
    const raw = (await generateContent(prompt)).trim()
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

function isDealArticle(title: string, geography?: string, rawQuery?: string, isLocal?: boolean): boolean {
  const t = title.toLowerCase()
  if (NOISE_PATTERNS.some(p => t.includes(p))) return false
  if (!DEAL_KEYWORDS.some(kw => t.includes(kw))) return false
  if (rawQuery && !isTopicRelevant(title, rawQuery)) return false
  if (geography && geography !== 'Other') {
    const aliases = GEO_ALIASES[geography] ?? [geography.toLowerCase()]
    if (!aliases.some(a => t.includes(a))) return false
  }
  return true
}

async function getDealData(geography: string, rawQuery: string) {
  const cutoff365 = nDaysAgo(365)
  const cutoff90 = nDaysAgo(90)
  const cutoff30 = nDaysAgo(30)

  const geoClause = geography !== 'Other' ? ` "${geography}"` : ''
  const q = rawQuery

  // English queries with geo clause
  const englishQueries = [
    `${q}${geoClause} acquires OR acquired OR merger OR "takes stake" OR buyout OR "roll-up"`,
    `${q}${geoClause} raises OR "funding round" OR "series a" OR "series b" OR "series c" OR "growth equity"`,
    `${q}${geoClause} "joint venture" OR "strategic investment" OR "equity stake" OR "strategic partnership"`,
    `${q}${geoClause} "seed round" OR "venture capital" OR "backs" OR "secures funding"`,
  ]

  // Local-language queries — no geo clause; locale params handle geography
  const locales = LOCALE_MAP[geography] ?? []
  const localQueries: Array<{ query: string; locale: { hl: string; gl: string; ceid: string } }> =
    locales.flatMap(locale => [
      { query: `${q} acquisition OR merger OR funding`, locale },
      { query: `${q} investment OR stake OR "series"`, locale },
    ])

  // Fetch English and local-language results in parallel
  const [englishBatches, localBatches] = await Promise.all([
    Promise.all(englishQueries.map(eq => fetchNewsItems(eq))),
    Promise.all(localQueries.map(({ query, locale }) => fetchNewsItems(query, locale))),
  ])

  const geoAliases = geography !== 'Other' ? (GEO_ALIASES[geography] ?? [geography.toLowerCase()]) : null

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
      if (!isTopicRelevant(item.title, rawQuery)) continue
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
    !item.isLocal || isTopicRelevant(item.title, rawQuery)
  )

  // Deduplicate same story reported by multiple outlets (≥4 shared content words)
  const items = deduplicateByContent(filteredItems)

  const monthMap = new Map<string, number>()
  let count30d = 0
  let count90d = 0

  for (const item of items) {
    const d = item.pub
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
    if (item.pub >= cutoff90) count90d++
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
    })
  }

  const sorted = [...items].sort((a, b) => b.pub.getTime() - a.pub.getTime())

  // Evidence links: geo + topic filtered; local items skip the geo-alias-in-title check
  const dealItems = sorted.filter(item => isDealArticle(item.title, geography, rawQuery, item.isLocal))
  const evidenceItems = dealItems
    .slice(0, 5)
    .map(item => ({
      title: item.title,
      url: item.url,
      published_date: item.published_date,
      source: item.source,
      isTranslated: !!item.originalTitle,
    }))

  // Synthesis context: all items for Gemini to reason from (includes translated local articles)
  const synthesisItems = sorted.slice(0, 15).map(({ pub: _, isLocal: __, originalTitle: ___, ...rest }) => rest)

  return { chartData, evidenceItems, synthesisItems, count30d, count90d }
}

// ── Step 3: Media mention count ────────────────────────────────────────────────

// High-quality financial news domains — weighted 2x in source count
const QUALITY_DOMAINS = new Set([
  'ft.com', 'reuters.com', 'bloomberg.com', 'wsj.com', 'economist.com',
  'financialtimes.com', 'dealbook.com', 'axios.com', 'businessinsider.com',
  'techcrunch.com', 'crunchbase.com', 'pitchbook.com', 'peHub.com',
])

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

async function getMediaMentionCount(rawQuery: string, geography: string): Promise<{ score: number; score30d: number; uniqueSources: number; headlines: string[] }> {
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

    // Google News RSS links all route through news.google.com — use item.creator
    // (publisher name) for deduplication; fall back to domain only if unavailable
    const sources = new Set<string>()
    const sources30d = new Set<string>()
    let score = 0
    let score30d = 0
    for (const item of feed.items) {
      if (!item.link || new Date(item.pubDate ?? 0) < cutoff) continue
      const sourceKey = item.creator?.trim() || extractDomain(item.link)
      const domain = extractDomain(item.link)
      const weight = QUALITY_DOMAINS.has(domain) ? 2 : 1
      if (!sources.has(sourceKey)) {
        sources.add(sourceKey)
        score += weight
      }
      if (new Date(item.pubDate ?? 0) >= cutoff30 && !sources30d.has(sourceKey)) {
        sources30d.add(sourceKey)
        score30d += weight
      }
    }
    const uniqueSources = sources.size

    // Collect up to 10 financially-relevant headlines, fully case-insensitive
    const headlines = feed.items
      .filter(item => {
        const text = ((item.title ?? '') + ' ' + (item.contentSnippet ?? '')).toLowerCase()
        return HEADLINE_KEYWORDS.some(k => text.includes(k.toLowerCase()))
      })
      .slice(0, 10)
      .map(item => item.title ?? '')
      .filter(Boolean)

    return { score, score30d, uniqueSources, headlines }
  } catch {
    return { score: 0, score30d: 0, uniqueSources: 0, headlines: [] }
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
        state: 'COOLING',
        colour: 'grey',
        explanation: 'A mature sector seeing reduced deal activity. Cyclical pause, repricing, or consolidation fatigue — worth monitoring for re-entry timing.',
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

type ThematicStage = 'Exploratory' | 'Emerging' | 'Consensus' | 'Crowded' | 'Exhausted'

function calculateThematicStage(
  consensusState: string,
  count90d: number,
  mediaCount90d: number,
): { stage: ThematicStage; meaning: string } {
  if (consensusState === 'COOLING' || consensusState === 'NARRATIVE') {
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
  if (count90d < 2 && mediaCount90d < 2) {
    return { stage: 'Exploratory', meaning: 'Signals are fragmented — either too early to call, or not yet a real theme.' }
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

const ANALYSIS_PROMPT_TEMPLATE = "================================================================================\nPREMIA — MARKET INTELLIGENCE BRIEF PROMPT\nVersion 2.0 (Revised)\n================================================================================\n\nYou are a pragmatic Private Equity Deal Origination Lead briefing a management\ncompany (ManCo) investment committee or a boutique M&A advisor.\n\nWrite a market intelligence brief based on the data provided.\n\n────────────────────────────────────────────────────────────────────────────────\nTONE & REGISTER\n────────────────────────────────────────────────────────────────────────────────\n\nYour tone is plain-spoken, commercial, and direct. Write the way a senior deal\nprofessional speaks in a committee room — not the way a journalist writes for a\ngeneral audience.\n\nWRONG: \"The sector is experiencing a remarkable wave of consolidation activity\n        driven by transformative digital disruption.\"\n\nRIGHT: \"Three platform acquisitions closed in 90 days. Buyers are moving,\n        and pricing is tightening as a result.\"\n\n────────────────────────────────────────────────────────────────────────────────\nCRITICAL RULES\n────────────────────────────────────────────────────────────────────────────────\n\n* Never explain how metrics are calculated.\n* Never define ratios, scores, or internal indicators.\n* Do not use filler phrases such as \"it is worth noting\", \"it is important\n  to consider\", \"overall\", \"narrative velocity\", or \"it is clear that\".\n* Do not simply restate the data. Every sentence must add interpretation,\n  implication, or context beyond what the raw numbers already say.\n* Draw conclusions only where evidence reasonably supports them.\n  Label speculation as such.\n* Focus on what is changing, not merely what exists.\n\n────────────────────────────────────────────────────────────────────────────────\nLENGTH DISCIPLINE\n────────────────────────────────────────────────────────────────────────────────\n\nEvery paragraph marked (3–4 sentences) must not exceed 80 words.\nEvery paragraph marked (2–3 sentences) must not exceed 55 words.\nEvery INSIGHT or LENS block must not exceed 60 words.\n\nViolating these limits degrades output quality. Prioritise precision\nover coverage.\n\n────────────────────────────────────────────────────────────────────────────────\nLOW DATA FALLBACK\n────────────────────────────────────────────────────────────────────────────────\n\nIf 90-day deal count is below 5:\n\n* Explicitly acknowledge limited observable transaction activity in the\n  first sentence of Section 1.\n* Do not imply trend from fewer than 3 data points.\n* Avoid making strong conclusions from sparse data.\n* Shift emphasis toward structural drivers, regulatory developments,\n  buyer behaviour, industry evolution, and longer-term capital allocation\n  themes relevant to the sector and geography.\n* Discuss what would need to happen for activity to accelerate.\n\n────────────────────────────────────────────────────────────────────────────────\nDATA QUALITY RULE\n────────────────────────────────────────────────────────────────────────────────\n\nIf recent_deals_json contains fewer than 3 named transactions with\nidentifiable buyers and targets, flag this explicitly before Section 1\nwith the line:\n\n\"⚠ Transaction data is thin. Structural analysis weighted over deal\n   pattern inference.\"\n\nDo not infer buyer behaviour patterns from unnamed or incomplete deal records.\n\n────────────────────────────────────────────────────────────────────────────────\nDATA PAYLOAD\n────────────────────────────────────────────────────────────────────────────────\n\n* Thesis being evaluated:  {user_input}\n* Consensus score:         {consensus_state}\n* Deal count (last 30d):   {count_30d}\n* Deal count (last 90d):   {count_90d}\n* Media mentions (90d):    {media_count_90d}\n* Recent transactions:     {recent_deals_json}\n\n────────────────────────────────────────────────────────────────────────────────\nPRE-WRITE INSTRUCTION\n────────────────────────────────────────────────────────────────────────────────\n\nBefore writing, silently compute the ratio of media_count_90d to count_90d.\nIf media mentions exceed deal count by more than 5x, treat this as a\nsignal-to-noise divergence and reference it in Section 1, Paragraph 1.\n\nDo not show this calculation in the output.\n\n================================================================================\nOUTPUT STRUCTURE\n================================================================================\n\n────────────────────────────────────────────────────────────────────────────────\nSECTION 1 — MARKET BRIEF\n────────────────────────────────────────────────────────────────────────────────\n\nPARAGRAPH 1 — THE REALITY  (3–4 sentences, max 80 words)\n\nDescribe observed deal activity. Assess whether capital deployment appears\nactive, selective, accelerating, slowing, or stable. If media attention\nmaterially outpaces transaction activity, name that gap directly.\n\nPARAGRAPH 2 — THE MACRO CONTEXT  (3–4 sentences, max 80 words)\n\nExplain likely structural drivers. Consider regulatory shifts, buyer behaviour,\nfunding conditions, consolidation trends, technological change, demographic\ntrends, sector maturity, or macroeconomic factors. Do not list all of these —\nselect only those most relevant to the thesis.\n\nPARAGRAPH 3 — THE EXECUTION ANGLE  (2–3 sentences, max 55 words)\n\nDescribe the most sensible tactical approach for advisors, investors, and\nemerging managers. Focus on practical actions rather than predictions.\nOne specific action per audience type.\n\n────────────────────────────────────────────────────────────────────────────────\nSECTION 2 — INSIGHT EXTRACTION\n────────────────────────────────────────────────────────────────────────────────\n\nSURPRISING OBSERVATION  (max 60 words)\n\nIdentify the single most interesting observation in the data.\n\nRequirements:\n* Must be non-obvious.\n* Must not simply restate deal counts.\n* Should highlight a tension, contradiction, asymmetry, or unusual pattern.\n\nWHY THIS MATTERS  (max 60 words)\n\nExplain the strategic significance.\n\nRequirements:\n* Focus on implications.\n* Avoid repeating the observation.\n* Explain what this suggests about capital allocation, competition,\n  sector maturity, or market structure.\n\nWHAT MOST PEOPLE MISS  (max 60 words)\n\nIdentify the conclusion an average observer would likely overlook.\n\nRequirements:\n* Focus on second-order effects.\n* Explain what a sophisticated investor or advisor may infer.\n\n────────────────────────────────────────────────────────────────────────────────\nSECTION 3 — CONTRARIAN LENS\n────────────────────────────────────────────────────────────────────────────────\n\nALTERNATIVE INTERPRETATION  (max 60 words)\n\nPresent the strongest credible argument against the primary reading.\n\nRequirements:\n* Use only evidence present in the data payload.\n* The alternative must lead to a materially different action or allocation\n  decision — if it doesn't change what someone would do, it is not a\n  useful contrarian view.\n* Do not introduce external assumptions not grounded in the data.\n\nWHAT DATA WOULD CHANGE THE VIEW\n\nIdentify the additional evidence needed to determine which interpretation\nis more likely correct. Be specific — name the data type, not just the theme.\n\nMaximum 3 bullet points. Each bullet under 20 words.\n\n────────────────────────────────────────────────────────────────────────────────\nSECTION 4 — CHANGE DETECTION\n────────────────────────────────────────────────────────────────────────────────\n\nWHAT APPEARS TO BE CHANGING\n\nFocus only on observable shifts. Do not include static structural facts.\n\n3 bullets. Each under 20 words. Start each bullet with an active verb.\n\nExamples of valid shift categories:\n* Buyer behaviour\n* Valuation behaviour\n* Capital allocation patterns\n* Consolidation dynamics\n* Sector maturity\n* Competitive structure\n\n────────────────────────────────────────────────────────────────────────────────\nSECTION 5 — WHO SHOULD CARE\n────────────────────────────────────────────────────────────────────────────────\n\nOne sentence each. Max 25 words per line. Focus on implications, not summaries.\n\n* Investors:\n* Founders:\n* Corporate Strategy Teams:\n* Consultants:\n* M&A Advisors:\n\n================================================================================\nEND OF PROMPT\n================================================================================\n"

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

  if (params.sourceCount < 3) {
    return {
      verdict: 'INSUFFICIENT DATA',
      badge: 'LOW CONFIDENCE',
      confidence,
      displayNote: `Only ${params.sourceCount} independent source(s) tracked. Not enough independent sources to assess narrative velocity reliably.`,
      showRawVerdict: false,
    }
  }

  if (confidence < 0.3) {
    return {
      verdict: 'INSUFFICIENT DATA',
      badge: 'LOW CONFIDENCE',
      confidence,
      displayNote: `Only ${params.sourceCount} source(s) and ${params.dataVolume} tracked item(s). Too thin to call a signal reliably.`,
      showRawVerdict: false,
    }
  }

  if (confidence < 0.6) {
    return {
      verdict: params.rawVerdict,
      badge: 'DIRECTIONAL - LOW SAMPLE',
      confidence,
      displayNote: `Based on ${params.sourceCount} sources and ${params.dataVolume} tracked items. Directionally useful, not statistically robust.`,
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

function buildPremiaAnalysisPrompt(params: {
  userInput: string
  consensusState: string
  count30d: number
  count90d: number
  mediaCount90d: number
  synthesisItems: unknown[]
}): string {
  return ANALYSIS_PROMPT_TEMPLATE
    .replace('{user_input}', params.userInput)
    .replace('{consensus_state}', params.consensusState)
    .replace('{count_30d}', String(params.count30d))
    .replace('{count_90d}', String(params.count90d))
    .replace('{media_count_90d}', String(params.mediaCount90d))
    .replace('{recent_deals_json}', JSON.stringify(params.synthesisItems))
}

async function generateThesis(params: {
  userInput: string
  consensusState: string
  signalAssessment?: SignalAssessment
  maturity: Maturity
  maturityReason: string
  count30d: number
  count90d: number
  velocityRatio: number
  mediaCount90d: number
  sourceCount?: number
  dataVolume?: number
  synthesisItems: unknown[]
  lowDataMode: boolean
  newsHeadlines: string[]
  marketContext: import('@/lib/queries/marketContext').MarketContextResult | null
}): Promise<string> {
  if (params.signalAssessment && params.signalAssessment.confidence < 0.3) {
    const view =
      params.count90d > 0 || params.mediaCount90d > 0
        ? `Limited public signals are visible for this thesis, but the sample is too small to place the theme confidently. The more useful read is coverage quality: ${params.count90d} deal-related item(s), ${params.mediaCount90d} narrative-source mention(s), and ${params.sourceCount ?? 0} independent source(s) do not yet support a market verdict.`
        : `No reliable public signal is visible for this thesis in the current source set. That does not prove inactivity; it means Premia cannot separate market silence from source-coverage limits yet.`
    const risk = `Risk: local, private, or differently named activity may be missing from tracked feeds, so this should be treated as a monitoring lead rather than an investment signal.`
    return `${view} ${risk}`
  }

  const prompt = buildPremiaAnalysisPrompt({
    userInput: params.userInput,
    consensusState: params.consensusState,
    count30d: params.count30d,
    count90d: params.count90d,
    mediaCount90d: params.mediaCount90d,
    synthesisItems: params.synthesisItems,
  })

  let rawResponseText = ''
  try {
    rawResponseText = (await generateContent(prompt)).trim()
    console.log('[generateThesis] response length:', rawResponseText.length, '| preview:', rawResponseText.slice(0, 80))
    if (rawResponseText.length > 100) return rawResponseText
    throw new Error(`Response too short (${rawResponseText.length} chars): "${rawResponseText.slice(0, 120)}"`)
  } catch (err) {
    console.error('[generateThesis] error:', err instanceof Error ? err.message : err)
    if (rawResponseText) console.error('[generateThesis] raw response was:', rawResponseText.slice(0, 300))

    // Truly empty — no transactions and no media coverage captured at all.
    // Return a plain honest message rather than fabricating analysis from zeros.
    if (params.count90d === 0 && params.mediaCount90d === 0) {
      const contextDesc = {
        MATURE:   `This is a well-established market in this geography with a long deal history and deep institutional participation.`,
        EMERGING: `This sector is in active development in this geography, with institutional capital present but not yet at scale.`,
        NASCENT:  `This is an early-stage or frontier market for this sector and geography, where confirmed transaction history is thin and the buyer universe is still forming.`,
      }[params.maturity]

      return [
        contextDesc,
        `No confirmed transactions or media coverage matched this thesis over the last 90 days. That can mean the theme is genuinely pre-institutional, or that deal activity is happening below the size threshold that attracts press — or that the search terms did not map cleanly onto how this sector is covered.`,
        `The absence of data is itself a data point, but its direction is ambiguous. It does not confirm that nothing is happening; it confirms that what is happening is not yet visible through public deal flow or mainstream coverage. The specific missing information is a reliable source of private transaction data for this sector and geography.`,
        `No signal classification is reliable at zero data. This thesis warrants monitoring rather than a verdict — the first confirmed transaction or sustained media mention would materially change the read.`,
      ].join('\n\n')
    }

    // Partial data fallback — some signal exists, synthesise what we have.
    const velocityDesc = params.velocityRatio >= 2
      ? `${params.velocityRatio.toFixed(1)}× — deal activity is significantly outpacing media coverage`
      : params.velocityRatio >= 1
        ? `${params.velocityRatio.toFixed(1)}× — capital flow and coverage are broadly in step`
        : params.count90d >= 3
          ? `${params.velocityRatio.toFixed(1)}× — media coverage is running ahead of confirmed transactions`
          : `insufficient confirmed transactions to draw a reliable ratio`

    const trendDesc = params.velocityRatio >= 1.5
      ? `accelerating: the 30-day rate (${params.count30d} items) is ${params.velocityRatio.toFixed(1)}× the prior two-month pace`
      : params.count30d === 0 && params.count90d > 0
        ? `stalled — no items in the last 30 days after ${params.count90d} in the prior 60`
        : params.count30d === 0
          ? `flat — no items recorded in the 90-day window`
          : params.velocityRatio < 0.7
            ? `decelerating — the 30-day rate is below the prior two-month average`
            : `steady — ${params.count30d} items in the last 30 days, consistent with the prior run rate`

    const contextDesc = {
      MATURE:   `This is a well-established market in this geography with a deep institutional buyer universe and long deal history. Participants typically include strategic acquirers, large PE funds, and sovereign capital. The structural forces driving activity are largely cyclical or consolidation-driven rather than thematic.`,
      EMERGING: `This sector is in active development in this geography — deal flow is building but the market has not yet consolidated around a standard set of buyers, structures, or valuations. Institutional capital is present but not yet at scale, and information asymmetry between early movers and later entrants is likely still meaningful.`,
      NASCENT:  `This is an early-stage or frontier market for this sector and geography. Confirmed transaction history is limited, the buyer universe is still forming, and standard deal structures have not yet emerged. Institutional capital is in an exploratory phase — most activity, where it exists, is likely opportunistic rather than programmatic.`,
    }[params.maturity]

    const gapDesc = params.count90d > params.mediaCount90d * 1.5
      ? `Deal count (${params.count90d}) is running ahead of tracked media mentions (${params.mediaCount90d}) — capital is moving faster than the press is covering it.`
      : params.mediaCount90d > params.count90d * 1.5
        ? `Media mentions (${params.mediaCount90d}) are running well ahead of confirmed transactions (${params.count90d}) — narrative interest has not yet translated into deal flow.`
        : `Deal count (${params.count90d}) and media mentions (${params.mediaCount90d}) are broadly in step.`

    const s = params.consensusState
    const structuralRead =
      s === 'EARLY SIGNAL' ? `Capital is moving ahead of narrative. The ${params.velocityRatio.toFixed(1)}× velocity ratio is consistent with pre-consensus institutional positioning — though at ${params.count90d} tracked deals, the absolute base is${params.count90d < 5 ? ' thin enough that the ratio is directional rather than conclusive' : ' sufficient to treat the pattern as real'}. The more probable reading is that the theme has not yet attracted mainstream press attention, not that it lacks institutional interest.` :
      s === 'CONSENSUS'    ? `Capital and narrative are moving together. Deal flow and media coverage are broadly in step, which means the thesis is priced into the attention of most active participants. Information asymmetry here is limited — edge comes from depth of analysis within the theme, not from discovering it.` :
      s === 'HYPE'         ? `Narrative is running well ahead of confirmed capital deployment. Media coverage (${params.mediaCount90d} mentions) significantly exceeds tracked transactions (${params.count90d} deals) — the gap is consistent with a theme that has captured editorial attention before institutional capital has committed at scale. Whether deal flow follows is the open question; the current data does not resolve it.` :
      s === 'QUIET'        ? `Both deal activity and media coverage are limited. Sparse data here is itself informative, but its direction is ambiguous: it is consistent with a theme too early for institutional capital to have arrived, or with a thesis that lacks structural substance. The two readings have opposite implications and the current data does not distinguish between them.` :
      s === 'ACTIVE'       ? `A mature sector running at an active pace. Deal flow is consistent with normal market conditions for an established category — the question is not whether activity is present but whether current pricing reflects a cyclical peak or durable structural demand.` :
      s === 'ESTABLISHED'  ? `This is a known, priced market. Steady deal activity in an established category does not generate information asymmetry — every active participant has access to the same signal. Edge here is execution and relationship depth, not discovery.` :
      s === 'NARRATIVE'    ? `In a mature sector, narrative is running ahead of current transaction volume. That gap most commonly reflects a cyclical pause in deal activity rather than genuine demand destruction — but the data does not resolve whether transactions will follow commentary or whether sentiment will correct first.` :
      s === 'COOLING'      ? `Activity is declining from prior levels in an established category. The data is consistent with three distinct explanations — cyclical pause, valuation repricing, or structural demand contraction — and does not distinguish between them. The direction of the next move depends on which of those is primary.` :
      `The ${s} signal reflects the current relationship between deal activity (${params.count90d} tracked, 90 days) and media coverage (${params.mediaCount90d} mentions, 90 days).`

    // Only include deal evidence items — not generic search results
    const dealEvidenceTitles = (params.synthesisItems as { title: string }[])
      .filter(i => /^[\x20-\x7E]+$/.test(i.title) && params.count90d > 0)
      .slice(0, 2)
      .map(i => i.title)
    const evidenceLine = dealEvidenceTitles.length > 0
      ? ` Recent tracked items include: ${dealEvidenceTitles.join('; ')}.`
      : ''

    const smallBase = params.count90d < 5 ? ' The base is small — treat these readings as directional.' : ''
    const last30 = params.count30d > 0 ? `, with ${params.count30d} in the last 30 days` : ', with none in the last 30 days'

    return [
      contextDesc,
      `${params.count90d} deal-related items were tracked in the last 90 days${last30}. Trend is ${trendDesc}. Velocity ratio: ${velocityDesc}.${smallBase}`,
      `${gapDesc}${evidenceLine} ${structuralRead}`,
      `The gap between deal activity (${params.count90d}) and media coverage (${params.mediaCount90d}) is the primary data point here. Whether that gap reflects genuine information asymmetry or a coverage limit on this thesis is the interpretive question the signal raises but does not resolve.`,
    ].join('\n\n')
  }
}

// ── Step 5b: Premia Read ───────────────────────────────────────────────────────

async function generatePremiaRead(params: {
  userInput: string
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
}): Promise<string> {
  if (!params.signalAssessment.showRawVerdict) {
    return `${params.signalAssessment.displayNote} Treat this as a lead for widening the source set, not a market verdict.`
  }

  const prompt = `Write a "Premia Read" — a one-paragraph house view for an institutional reader who will act on this in the next 48 hours.

This is NOT a summary of the data. It is an interpretation. Answer the question that matters: given these signals, what is actually happening here, and what does it tell someone trying to understand the state of this theme?

You must answer at least two of these (the ones the data speaks to):
- Is capital moving before narrative, or is narrative outpacing capital?
- Is this early institutional positioning or late-stage consensus crowding?
- Is the theme structurally durable or temporarily fashionable?
- Is sparse data here informative — and in which direction?
- What does the narrative velocity tell us about the timing of consensus formation?

Rules:
- State one view. Do not write "one reading is X, alternatively Y"; pick the more probable reading given the data.
- State the single biggest risk to that view in one sentence.
- If the sample size is too small to support a confident view, say so in one sentence and stop.
- Never let a confidence caveat coexist with a strong claim. If the caveat is true, downgrade the claim to match it.
- Cite the actual sourcing gap when relevant. If source coverage is thin, say "our narrative-tracking coverage is thin here" rather than implying a market-level information asymmetry.
- Maximum 120 words.
- Take a definitive stance. No vague neutrality.
- Probabilistic where genuine uncertainty exists, but do not hide behind uncertainty.
- No recommendations ("investors should", "this represents an opportunity").
- Banned phrases: "it is worth noting", "it is important to consider", "robust", "landscape", "ecosystem", "transformative", "stakeholders", "well-positioned", "it remains to be seen", "this underscores", "this highlights".
- 2–4 sentences. One idea per sentence. Present tense. Strong nouns.

Data:
- Thesis: ${params.userInput}
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

Return only one paragraph. No headers, no labels, no preamble.`

  try {
    const text = (await generateContent(prompt)).trim()
    if (text.length > 60) return text
    throw new Error('Too short')
  } catch {
    const fallbacks: Record<ThematicStage, string> = {
      'Exploratory': `The sample is too thin to call institutional positioning: ${params.count90d} deals, ${params.mediaCount90d} media mentions, and ${params.sourceCount} source(s) tracked. Risk: our coverage may be missing local or private-market activity.`,
      'Emerging': `Deal activity is ahead of tracked media, but the read is directional at ${params.sourceCount} sources and ${params.dataVolume} tracked items. Risk: the gap may reflect our narrative-tracking coverage rather than a true market information edge.`,
      'Consensus': 'The theme is widely understood and priced into the attention of most active participants. Information asymmetry is limited — edge comes from depth of analysis within the theme, not from discovering it.',
      'Crowded': 'Narrative has outrun capital deployment at a significant margin. The gap between coverage and confirmed transactions suggests saturation rather than undiscovered signal.',
      'Exhausted': 'Activity is declining in a context where narrative is still present. The theme appears to be repricing from peak enthusiasm — capital is not following the commentary.',
    }
    return fallbacks[params.thematicStage]
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { thesis } = await req.json()
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

    // Steps 1b + role-separated stored signal data + market context in parallel
    const [maturityResult, storedSignalData, fallbackDealData, fallbackMediaData, marketContext] = await Promise.all([
      classifyMaturity(thesis, sector, geography),
      getStoredSignalData(sector, geography, raw_query),
      getDealData(geography, raw_query),
      getMediaMentionCount(raw_query, geography),
      getMarketContext(sector, geography, raw_query),
    ])
    const { chartData, evidenceItems, synthesisItems, count30d, count90d } = storedSignalData?.dealData ?? fallbackDealData
    const {
      score: mediaCount90d,
      score30d: mediaCount30d,
      uniqueSources: mediaUniqueSources,
      headlines: newsHeadlines,
    } = storedSignalData?.mediaData ?? fallbackMediaData
    const confidenceMetadata = storedSignalData?.confidenceMetadata ?? {
      distinct_deal_source_count: new Set(
        (synthesisItems as { source?: string }[]).map(item => item.source?.trim()).filter(Boolean)
      ).size,
      distinct_narrative_source_count: mediaUniqueSources,
      feed_health_summary: [],
    }

    const lowDataMode = count90d < 3

    // Step 4
    const consensus = calculateConsensusScore(count90d, count30d, mediaCount90d, maturityResult.maturity)
    const priorRate = Math.max((count90d - count30d) / 60, 0.05)
    const velocityRatio = (count30d / 30) / priorRate
    const thematicStage = calculateThematicStage(consensus.state, count90d, mediaCount90d)
    const narrativeVelocity = calculateNarrativeVelocity(mediaCount30d, mediaCount90d)

    // Additional signal metrics and lightweight buyer composition heuristics
    const classifyBuyerFromTitle = (title: string) => {
      const t = title.toLowerCase()
      if (/private equity|pe firm|buyout|buyout firm|buyout fund|leveraged buyout|lbo|take private/.test(t)) return 'Private Equity'
      if (/acquir|acquired by|acquires|acquisition|strategic acquisition|strategic buyer|signed acquisition/.test(t)) return 'Strategic'
      if (/series [abcedf]|seed round|venture capital|vc firm|angel investor|venture-backed|raised/.test(t)) return 'VC'
      if (/sovereign wealth|sovereign fund|swf|state owned/.test(t)) return 'SWF'
      return 'Other'
    }

    const buyerCounts: Record<string, number> = { 'Strategic': 0, 'Private Equity': 0, 'VC': 0, 'SWF': 0, 'Other': 0 }
    for (const it of synthesisItems) {
      try {
        const title = (it as any).title || ''
        const cls = classifyBuyerFromTitle(title)
        buyerCounts[cls] = (buyerCounts[cls] || 0) + 1
      } catch {}
    }
    const totalBuyerSignals = Object.values(buyerCounts).reduce((s, v) => s + v, 0) || 1
    const buyerComposition = Object.fromEntries(Object.entries(buyerCounts).map(([k, v]) => [k, Math.round((v / totalBuyerSignals) * 100)]))

    // Premia score: weighted combination of normalized volume, recency, source breadth, and clarity
    const norm = (v: number, max = 50) => Math.min(100, Math.round((v / max) * 100))
    const dataVolumeScore = norm(count90d, 30)
    const recencyScore = norm(count30d, 12)
    const sourceBreadthScore = Math.min(100, Math.round((mediaUniqueSources / 20) * 100))
    const signalClarityScore = Math.max(10, Math.min(95, 80 - Math.abs((count90d - mediaCount90d)) * 4))
    const premiaScore = Math.round((dataVolumeScore * 0.3) + (recencyScore * 0.25) + (sourceBreadthScore * 0.2) + (signalClarityScore * 0.25))
    const dealSourceCount = confidenceMetadata.distinct_deal_source_count
    const sourceCount = Math.max(mediaUniqueSources, dealSourceCount)
    const dataVolume = count90d + mediaCount90d
    const signalAssessment = calculateSignalAssessment({
      rawVerdict: consensus.state,
      sourceCount,
      dataVolume,
      signalClarityScore,
    })

    // Deal momentum: percent change vs prior window approximation based on velocityRatio
    const dealMomentumPct = Math.round((velocityRatio - 1) * 100)

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
    if (count90d > mediaCount90d) whyBullets.push('Deal activity exceeds media activity')
    else if (mediaCount90d > count90d) whyBullets.push('Media attention exceeds confirmed transactions')
    if (count30d > 0) {
      whyBullets.push(count90d < 10
        ? `Recent activity: ${count30d} of ${count90d} tracked item(s) occurred in the last 30 days`
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
    if (Math.abs(count90d - mediaCount90d) >= Math.max(3, Math.round(0.4 * Math.max(count90d, mediaCount90d)))) {
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
    const threeThings = standout.slice(0, 3)

    // Scenario triggers (simple rules)
    const scenarioTriggers = [
      { event: 'Media coverage triples', likelyImpact: 'Moves toward crowded' },
      { event: 'Deal volume declines sharply', likelyImpact: 'Weakens conviction' },
      { event: 'PE activity accelerates', likelyImpact: 'Changes market structure' },
      { event: 'Venture funding surges', likelyImpact: 'Increases narrative velocity' },
    ]


    // Steps 5 + premia read in parallel
    const [thesisText, premiaRead] = await Promise.all([
      generateThesis({
        userInput: thesis,
        consensusState: consensus.state,
        signalAssessment,
        maturity: maturityResult.maturity,
        maturityReason: maturityResult.reason,
        count30d,
        count90d,
        velocityRatio,
        mediaCount90d,
        sourceCount,
        dataVolume,
        synthesisItems,
        lowDataMode,
        newsHeadlines,
        marketContext,
      }),
      generatePremiaRead({
        userInput: thesis,
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
      }),
    ])

    return NextResponse.json({
      low_data_mode: lowDataMode,
      consensus,
      signal_assessment: signalAssessment,
      chart_data: chartData,
      stats: {
        count_30d: count30d,
        count_90d: count90d,
        media_sources: mediaUniqueSources,
        media_30d: mediaCount30d,
        source_count: sourceCount,
        data_volume: dataVolume,
        distinct_deal_source_count: confidenceMetadata.distinct_deal_source_count,
        distinct_narrative_source_count: confidenceMetadata.distinct_narrative_source_count,
        feed_health_summary: confidenceMetadata.feed_health_summary,
        velocity_ratio: Math.round(velocityRatio * 100) / 100,
        signal_gap: count90d - mediaCount90d,
        confidence,
      },
      premia_read: premiaRead,
      thematic_stage: thematicStage,
      narrative_velocity: narrativeVelocity,
      thesis: thesisText,
      evidence: evidenceItems,
      market_context: marketContext,
      premia_score: premiaScore,
      deal_momentum: dealMomentumPct,
      narrative_velocity_score: narrativeVelocityScore,
      signal_strength: signalStrength,
      why_bullets: whyBullets,
      buyer_composition: buyerComposition,
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
