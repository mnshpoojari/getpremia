import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Parser from 'rss-parser'
import { getMarketContext } from '@/lib/queries/marketContext'

export const maxDuration = 60

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
const geminiFallback = genai.getGenerativeModel({ model: 'gemini-1.5-flash' })

async function generateContent(prompt: string): Promise<string> {
  try {
    const result = await gemini.generateContent(prompt)
    return result.response.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      const result = await geminiFallback.generateContent(prompt)
      return result.response.text()
    }
    throw err
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

async function generateThesis(params: {
  userInput: string
  consensusState: string
  maturity: Maturity
  maturityReason: string
  count30d: number
  count90d: number
  velocityRatio: number
  mediaCount90d: number
  synthesisItems: unknown[]
  lowDataMode: boolean
  newsHeadlines: string[]
}): Promise<string> {
  const dataContext = params.lowDataMode
    ? `- NOTE: Confirmed deal data for this thesis is limited (${params.count90d} transactions found). The analysis below should be treated as directional.
- Recent news headlines on this topic (use these as your primary evidence source):
  ${params.newsHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n  ')}`
    : `- Recent transactions: ${JSON.stringify(params.synthesisItems)}`

  const lowDataModeInstruction = params.lowDataMode
    ? `NOTE FOR THIS QUERY: Confirmed transaction data is limited. Base your analysis on the news headlines provided. Be explicit in the first paragraph that deal data is sparse and the analysis is based on market signals rather than confirmed transactions. Do not invent deals or figures that are not in the data provided.`
    : ''

  const prompt = `You are a senior analyst at a rigorous investment research firm. Your job is to interpret what a set of deal and media signals mean — not just describe them. You write for practitioners who need to understand not just what is happening, but what it means structurally and where the timing sits relative to the cycle.

ANALYTICAL LENSES — use all of them, weighted by what the data warrants:
- Signal gap: Is capital moving before narrative, or is narrative running ahead of capital? The gap between the two is where information asymmetry lives.
- Institutional positioning: What does the volume, velocity, and deal structure suggest about who is moving? Early institutional positioning looks different from late-stage consensus crowding.
- Narrative formation: Where is the theme in its story arc — pre-narrative, forming, mainstream, or post-peak?
- Thematic maturity: Is this a structurally durable shift or temporarily fashionable? What is the difference between the two in this specific case?
- Capital velocity: Is the rate of deal activity accelerating, decelerating, or steady? What does the trend shape imply — early accumulation, peak deployment, or distribution?
- Consensus timing: Is the market pricing this thesis too early, too late, or approximately right?
- Information asymmetry: Does sparse data mean undiscovered, or does it mean the signal is weaker than the narrative suggests? Both are valid readings — distinguish between them.

QUESTIONS THE SYNTHESIS MUST ENGAGE:
Ask these internally; answer the ones the data speaks to; name the ones it cannot resolve:
1. Is capital moving before narrative, or is narrative outpacing capital?
2. Is this a genuine emerging theme or media excitement without underlying transaction evidence?
3. Is sparse data itself informative — and if so, in which direction?
4. Are we observing early institutional positioning or late-stage consensus crowding?
5. Is the theme structurally durable or temporarily fashionable?
6. What kind of actors are most consistent with the deal structure and size visible in the data?
7. What does the absence of evidence imply here — and is that absence meaningful?

VOICE:
- Strongly opinionated about facts. Precise numbers, specific observations, named patterns.
- Probabilistic about interpretation. When a signal could mean two things, name both. Use calibrated language: "consistent with", "one reading of this is", "this could reflect", "absent other data", "the more probable reading is", "this is more likely explained by".
- Acknowledge uncertainty intelligently — not as a hedge, but as a precise description of what remains unresolved and why.
- Avoid false precision. A velocity ratio from 4 deals is not the same as one from 40. Say so.
- Avoid overclaiming. Avoid sensationalism. But do not hide behind vague neutrality — the final paragraph must take a stance.
- Silent on action. No "investors should", no "this represents an opportunity". The reader decides what to do. You decide what the signal means.
- Short sentences. Strong nouns. One idea per sentence. Never stack adjectives.

BANNED WORDS AND PHRASES: "it is worth noting", "it is important to consider", "overall", "robust", "landscape", "ecosystem", "untapped potential", "transformative", "stakeholders", "long-term value", "wave of innovation", "this represents an opportunity", "investors should", "well-positioned", "it remains to be seen", "this underscores", "this highlights", "this signals", "this reflects", "contributing to", "demonstrating", "showcasing", "in conclusion", "to summarise". Never end a sentence with a present participle clause added only for effect ("-ing the trend toward X"). Never open a paragraph with a scene-setter that exists only to announce what you are about to say.

DATA:
- Thesis: ${params.userInput}
- Signal classification: ${params.consensusState}
- Deals last 30 days: ${params.count30d}
- Deals last 90 days: ${params.count90d}
- Media mentions last 90 days: ${params.mediaCount90d}
- Velocity ratio: ${params.velocityRatio.toFixed(2)}x (deal rate per day ÷ media mention rate per day)
  Interpretation guide:
  - Above 2.0x: capital moving faster than coverage — consistent with pre-narrative institutional positioning, or with deals closing below the size threshold that attracts press
  - 1.0–2.0x: deal activity and coverage broadly in step — consensus range
  - Below 1.0x: coverage running ahead of transactions — narrative overhang, or a data gap where deals are closing quietly and unreported
  - Any ratio derived from fewer than 5 deals is directional only, not statistically meaningful
- Sector maturity: ${params.maturity} — ${params.maturityReason}
${dataContext}

${lowDataModeInstruction}

Write exactly five paragraphs. No headers. No bullets. No preamble. No sign-off.

Paragraph 1 — Orientation (120–180 words):
Set the scene for a reader who may be new to this sector or geography. Answer in this order: What is this sector or theme — what activity does it describe and what is its core value proposition? Who are the typical participants — what types of buyers, sellers, and operators are involved? What stage is the market in this geography — is it established and deep, actively developing, fragmented, or at a genuinely early frontier stage? What structural forces are driving it right now — regulatory shifts, demographic changes, technological inflection, cost dynamics, or capital cycle? And why does it matter at this particular moment — what has changed in the last 12–24 months that makes this thesis timely rather than generic? Close with a single sentence on whether institutional capital is deeply embedded in this theme or still in an exploratory phase. Be specific to this sector and geography — a paragraph about healthcare IT in India should be visibly different from one about healthcare IT in the US. No data points from the signal analysis yet. This paragraph is purely contextual.

Paragraph 2 — Why this matters and what the data shows (3–4 sentences):
Open with the structural reason this sector and geography are in motion right now — the regulatory, economic, or structural force that creates the context. Then state the numbers: deal volume, trend direction, velocity ratio. Where the count is small, say so and name what it limits. Do not interpret yet, but give the reader the structural frame before the numbers.

Paragraph 3 — What the pattern suggests structurally (3–4 sentences):
Engage the analytical lenses directly. Is capital moving before or after narrative? What does the velocity pattern suggest about where institutional positioning sits — early accumulation, peak consensus, or distribution? Name the two most plausible readings of the same data and what would distinguish between them. If specific deals or headlines in the data sharpen the interpretation, name them. Do not force a contradiction where the data is genuinely consistent, but do not smooth over a real tension either.

Paragraph 4 — Second-order implications and what the signal cannot resolve (2–3 sentences):
Name the structural tensions or timing mismatches visible in this data — places where capital and narrative are moving at different speeds, or where the theme's durability is structurally uncertain. Then name the specific gaps: what buyer-type information is missing, what the absence of certain deal structures implies, what a different data source would reveal or contradict. If a commonly held assumption about this sector is not supported by what is here, name it plainly.

Paragraph 5 — The reasoned stance (2–3 sentences):
Take a position. Based on the weight of evidence, characterise this signal: is it early, consensus, crowded, immature, or misleading — and why? This is not a hedge and not a recommendation. It is a specific interpretive claim that a different sector, geography, or signal shape would not produce. The reader should finish this paragraph knowing not just what the data shows but what it means.

Return only the five paragraphs. No headers, no bullets, no preamble.`

  let rawResponseText = ''
  try {
    rawResponseText = (await generateContent(prompt)).trim()
    if (rawResponseText.length > 100) return rawResponseText
    throw new Error(`Response too short (${rawResponseText.length} chars): "${rawResponseText.slice(0, 120)}"`)
  } catch (err) {
    console.error('Gemini thesis error:', err instanceof Error ? err.message : err)
    if (rawResponseText) console.error('Gemini raw response was:', rawResponseText.slice(0, 300))

    // Fallback — four paragraphs matching the prompt's structure, no banned words
    const velocityDesc = params.velocityRatio >= 2
      ? `${params.velocityRatio.toFixed(1)}× — deal activity is significantly outpacing media coverage, an early signal worth naming`
      : params.velocityRatio >= 1
        ? `${params.velocityRatio.toFixed(1)}× — capital flow and coverage are broadly in step`
        : params.count90d >= 3
          ? `${params.velocityRatio.toFixed(1)}× — media coverage is running ahead of confirmed transactions`
          : `insufficient confirmed transactions to draw a reliable ratio`

    const trendDesc = params.velocityRatio >= 1.5
      ? `accelerating: the 30-day rate (${params.count30d} items) is ${params.velocityRatio.toFixed(1)}× the prior two-month pace`
      : params.count30d === 0
        ? `stalled — no items recorded in the last 30 days despite ${params.count90d} in the prior 60`
        : params.velocityRatio < 0.7
          ? `decelerating — the 30-day rate is below the prior two-month average`
          : `steady — ${params.count30d} items in the last 30 days, consistent with the prior run rate`

    const contextDesc = {
      MATURE:   `This is a well-established market in this geography with a deep institutional buyer universe and long deal history. Participants typically include strategic acquirers, large PE funds, and sovereign capital. Valuations and deal structures are widely understood. The structural forces driving activity are largely cyclical or consolidation-driven rather than thematic.`,
      EMERGING: `This sector is in active development in this geography — deal flow is building but the market has not yet consolidated around a standard set of buyers, structures, or valuations. The theme is real but not yet deep. Institutional capital is present but not yet at scale, and information asymmetry between early movers and later entrants is likely still meaningful.`,
      NASCENT:  `This is an early-stage or frontier market for this sector and geography. Confirmed transaction history is limited, the buyer universe is still forming, and standard deal structures have not yet emerged. Institutional capital is in an exploratory phase — most activity, where it exists, is likely opportunistic rather than programmatic.`,
    }[params.maturity]

    const maturityDesc = {
      MATURE:   `This is an established deal category in this geography.`,
      EMERGING: `This sector is active but not yet consolidated in this geography.`,
      NASCENT:  `Confirmed transaction history here is thin.`,
    }[params.maturity]

    const gapDesc = params.count90d > params.mediaCount90d * 1.5
      ? `Deal count (${params.count90d}) is running ahead of tracked media mentions (${params.mediaCount90d}) — capital is moving faster than the press is covering it.`
      : params.mediaCount90d > params.count90d * 1.5
        ? `Media mentions (${params.mediaCount90d}) are running well ahead of confirmed transactions (${params.count90d}) — narrative interest has not yet translated into deal flow.`
        : `Deal count (${params.count90d}) and media mentions (${params.mediaCount90d}) are broadly in step — the thesis is as well-tracked as it is active.`

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

    const englishTitles = (params.synthesisItems as { title: string }[])
      .filter(i => /^[\x20-\x7E]+$/.test(i.title))
      .slice(0, 2)
      .map(i => i.title)
    const evidenceLine = englishTitles.length > 0
      ? `Recent tracked items include: ${englishTitles.join('; ')}.`
      : ''

    const smallBase = params.count90d < 5 ? ' The base is small — treat these readings as directional.' : ''
    const last30 = params.count30d > 0 ? `, with ${params.count30d} in the last 30 days` : ', with none in the last 30 days'

    return [
      contextDesc,
      `${maturityDesc} ${params.count90d} deal-related items were tracked in the last 90 days${last30}. Trend is ${trendDesc}. Velocity ratio: ${velocityDesc}.`,
      `${gapDesc}${evidenceLine ? ' ' + evidenceLine : ''}`,
      structuralRead,
      `Signal classification: ${s}.${smallBase} The gap between deal activity (${params.count90d}) and media coverage (${params.mediaCount90d}) is the primary data point here. Whether that gap reflects information asymmetry or a data collection limit is the interpretive question this signal raises but does not resolve.`,
    ].join('\n\n')
  }
}

// ── Step 5b: Premia Read ───────────────────────────────────────────────────────

async function generatePremiaRead(params: {
  userInput: string
  consensusState: string
  thematicStage: ThematicStage
  narrativeVelocityLabel: NarrativeVelocityLabel
  count90d: number
  mediaCount90d: number
  velocityRatio: number
  maturity: Maturity
}): Promise<string> {
  const prompt = `Write a "Premia Read" — a 2–4 sentence interpretive verdict on what this market signal means.

This is NOT a summary of the data. It is an interpretation. Answer the question that matters: given these signals, what is actually happening here, and what does it tell someone trying to understand the state of this theme?

You must answer at least two of these (the ones the data speaks to):
- Is capital moving before narrative, or is narrative outpacing capital?
- Is this early institutional positioning or late-stage consensus crowding?
- Is the theme structurally durable or temporarily fashionable?
- Is sparse data here informative — and in which direction?
- What does the narrative velocity tell us about the timing of consensus formation?

Rules:
- Take a definitive stance. No vague neutrality.
- Probabilistic where genuine uncertainty exists, but do not hide behind uncertainty.
- No recommendations ("investors should", "this represents an opportunity").
- Banned phrases: "it is worth noting", "it is important to consider", "robust", "landscape", "ecosystem", "transformative", "stakeholders", "well-positioned", "it remains to be seen", "this underscores", "this highlights".
- 2–4 sentences. One idea per sentence. Present tense. Strong nouns.

Data:
- Thesis: ${params.userInput}
- Signal: ${params.consensusState}
- Thematic stage: ${params.thematicStage}
- Narrative velocity: ${params.narrativeVelocityLabel}
- Deals (90d): ${params.count90d} · Media mentions (90d): ${params.mediaCount90d}
- Capital-to-narrative ratio: ${params.velocityRatio.toFixed(2)}x
- Sector maturity: ${params.maturity}

Return only the 2–4 sentences. No headers, no labels, no preamble.`

  try {
    const text = (await generateContent(prompt)).trim()
    if (text.length > 60) return text
    throw new Error('Too short')
  } catch {
    const fallbacks: Record<ThematicStage, string> = {
      'Exploratory': 'The signal is too fragmented to draw a reliable conclusion about institutional positioning. Either this is genuinely pre-institutional, or the theme has not yet been named in a way that attracts press coverage.',
      'Emerging': `Capital is moving before the narrative has fully formed — the ${params.velocityRatio.toFixed(1)}x velocity ratio is consistent with early institutional positioning rather than consensus crowding. The information advantage here exists precisely because coverage is thin.`,
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

    // Steps 1b + 2 + 3 in parallel
    const [maturityResult, { chartData, evidenceItems, synthesisItems, count30d, count90d }, { score: mediaCount90d, score30d: mediaCount30d, uniqueSources: mediaUniqueSources, headlines: newsHeadlines }] = await Promise.all([
      classifyMaturity(thesis, sector, geography),
      getDealData(geography, raw_query),
      getMediaMentionCount(raw_query, geography),
    ])

    const lowDataMode = count90d < 3

    // Step 4
    const consensus = calculateConsensusScore(count90d, count30d, mediaCount90d, maturityResult.maturity)
    const priorRate = Math.max((count90d - count30d) / 60, 0.05)
    const velocityRatio = (count30d / 30) / priorRate
    const thematicStage = calculateThematicStage(consensus.state, count90d, mediaCount90d)
    const narrativeVelocity = calculateNarrativeVelocity(mediaCount30d, mediaCount90d)

    // Steps 5 + market context + premia read in parallel
    const [thesisText, marketContext, premiaRead] = await Promise.all([
      generateThesis({
        userInput: thesis,
        consensusState: consensus.state,
        maturity: maturityResult.maturity,
        maturityReason: maturityResult.reason,
        count30d,
        count90d,
        velocityRatio,
        mediaCount90d,
        synthesisItems,
        lowDataMode,
        newsHeadlines,
      }),
      getMarketContext(sector, geography, raw_query),
      generatePremiaRead({
        userInput: thesis,
        consensusState: consensus.state,
        thematicStage: thematicStage.stage,
        narrativeVelocityLabel: narrativeVelocity.label,
        count90d,
        mediaCount90d,
        velocityRatio,
        maturity: maturityResult.maturity,
      }),
    ])

    const confidence: 'high' | 'medium' | 'low' =
      count90d >= 20 ? 'high' : count90d >= 7 ? 'medium' : 'low'

    return NextResponse.json({
      low_data_mode: lowDataMode,
      consensus,
      chart_data: chartData,
      stats: {
        count_30d: count30d,
        count_90d: count90d,
        media_sources: mediaUniqueSources,
        media_30d: mediaCount30d,
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
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Analyse error:', message)
    return NextResponse.json({ error: 'Analysis failed', detail: message }, { status: 500 })
  }
}
