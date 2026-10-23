import { GoogleGenerativeAI } from '@google/generative-ai'
import { tavily } from '@tavily/core'
import { runSearch, type TavilyResult } from '../tavilyResearch'
import type { MarketContextResult } from '../queries/marketContext'
import {
  benchmarkEntries,
  buildExtractionPrompt,
  buildGoogleNewsRequestBody,
  capArticle,
  dealEvidenceEntry,
  decodeLegacyGoogleNewsUrl,
  extractGoogleNewsSignature,
  googleNewsArticleId,
  isGoogleNewsUrl,
  isSafePublicUrl,
  looksLikeBlockedPage,
  normaliseText,
  numberEntries,
  parseExtractionJson,
  parseGoogleNewsResponse,
  searchResultEntries,
  stripHtml,
  validateDealExtraction,
  withDeadline,
} from './evidenceParse'

// ── Types ──────────────────────────────────────────────────────────────────────

export type EvidenceType =
  | 'deal_fact'
  | 'headline_only'
  | 'research_regulation'
  | 'research_acquirers'
  | 'research_transactions'
  | 'benchmark'

export type EvidenceDraft = {
  type: EvidenceType
  text: string
  source: string | null
  url: string | null
  date: string | null
}

export type EvidenceEntry = EvidenceDraft & { id: string }

export type EvidenceDealInput = {
  title: string
  url: string
  published_date?: string
  source?: string
}

export type EvidenceStats = {
  deals_considered: number
  deals_with_article_text: number
  google_news_links: number
  google_news_resolved: number
  tavily_search_calls: number
  tavily_extract_calls: number
  tavily_extract_urls: number
  plain_fetches: number
  gemini_calls: number
  research_cache: 'hit' | 'miss' | 'skipped'
  elapsed_ms: number
  timed_out: boolean
}

export type EvidenceResult = { entries: EvidenceEntry[]; stats: EvidenceStats }

export type EvidenceInput = {
  thesis: string
  sector: string
  geography: string
  dealItems: EvidenceDealInput[]
  marketContext?: MarketContextResult | null
}

// ── Limits ─────────────────────────────────────────────────────────────────────

const MAX_DEALS = 8
const TOTAL_BUDGET_MS = 20_000
const MAX_EXTRACT_CALLS = 8
const MAX_EXTRACT_URLS = 8
const FETCH_TIMEOUT_MS = 6_000
const RESOLVE_TIMEOUT_MS = 8_000
const GEMINI_MODEL = 'gemini-2.5-flash'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

type Counters = {
  searchCalls: number
  extractCalls: number
  extractUrls: number
  plainFetches: number
  geminiCalls: number
  gnTotal: number
  gnResolved: number
  articleText: number
}

// ── Google News resolution ─────────────────────────────────────────────────────

// Google News links are redirects, not articles. Resolve to the publisher URL or give up.
async function resolveGoogleNewsUrl(link: string): Promise<string | null> {
  const id = googleNewsArticleId(link)
  if (!id) return null
  const legacy = decodeLegacyGoogleNewsUrl(id)
  if (legacy) return legacy
  try {
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    })
    const sig = extractGoogleNewsSignature(await page.text())
    if (!sig) return null
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': BROWSER_UA },
      body: buildGoogleNewsRequestBody(id, sig.ts, sig.sg),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    })
    return parseGoogleNewsResponse(await res.text())
  } catch {
    return null
  }
}

async function resolveDealUrl(url: string, counters: Counters): Promise<string | null> {
  if (!url) return null
  if (!isGoogleNewsUrl(url)) return isSafePublicUrl(url) ? url : null
  counters.gnTotal++
  const resolved = await resolveGoogleNewsUrl(url)
  if (resolved && isSafePublicUrl(resolved)) {
    counters.gnResolved++
    return resolved
  }
  return null
}

// ── Article text ───────────────────────────────────────────────────────────────

async function plainFetchArticle(url: string, counters: Counters): Promise<string | null> {
  counters.plainFetches++
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    if (!isSafePublicUrl(res.url || url) || isGoogleNewsUrl(res.url || url)) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null
    const body = (await res.text()).slice(0, 600_000)
    const text = type.includes('text/plain') ? body : stripHtml(body)
    return looksLikeBlockedPage(text) ? null : capArticle(text)
  } catch {
    return null
  }
}

async function tavilyExtract(urls: string[], counters: Counters): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!process.env.TAVILY_API_KEY || urls.length === 0 || counters.extractCalls >= MAX_EXTRACT_CALLS) return out
  const batch = urls.slice(0, MAX_EXTRACT_URLS)
  counters.extractCalls++
  counters.extractUrls += batch.length
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY })
    const res = await client.extract(batch, { extractDepth: 'basic', format: 'text', timeout: 12 })
    for (const r of res.results ?? []) {
      const text = capArticle(r.rawContent ?? '')
      if (!looksLikeBlockedPage(text)) out[r.url.replace(/\/$/, '')] = text
    }
  } catch (err) {
    console.warn('[evidence] tavily extract failed:', err instanceof Error ? err.message.slice(0, 160) : String(err))
  }
  return out
}

// ── Gemini extraction ──────────────────────────────────────────────────────────

async function extractDealFacts(
  articles: { id: number; title: string; text: string }[],
  counters: Counters,
  msLeft: number,
): Promise<Record<number, Record<string, unknown>>> {
  if (articles.length === 0 || !process.env.GEMINI_API_KEY || msLeft < 1500) return {}
  counters.geminiCalls++
  try {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genai.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    })
    const result = await withDeadline(
      model.generateContent(buildExtractionPrompt(articles)).then(r => r.response.text()).catch(err => {
        console.warn('[evidence] gemini call error:', err instanceof Error ? err.message.slice(0, 300) : String(err))
        return ''
      }),
      msLeft,
      () => '',
    )
    return parseExtractionJson(result)
  } catch (err) {
    console.warn('[evidence] gemini extraction failed:', err instanceof Error ? err.message.slice(0, 160) : String(err))
    return {}
  }
}

// ── Deal facts ─────────────────────────────────────────────────────────────────

function pickDeals(items: EvidenceDealInput[]): EvidenceDealInput[] {
  const seen: Record<string, true> = {}
  const picked: EvidenceDealInput[] = []
  for (const item of items) {
    if (!item || !item.title) continue
    const key = normaliseText(item.title)
    if (seen[key]) continue
    seen[key] = true
    picked.push(item)
    if (picked.length >= MAX_DEALS) break
  }
  return picked
}

async function runDealPipeline(
  deals: EvidenceDealInput[],
  drafts: EvidenceDraft[],
  counters: Counters,
  deadlineAt: number,
): Promise<void> {
  const finalUrls = await Promise.all(deals.map(d => resolveDealUrl(d.url, counters)))

  // Two headlines can resolve to the same article; extract each page once.
  const urlOwner: Record<string, number> = {}
  const urls: string[] = []
  finalUrls.forEach((u, i) => {
    if (!u) return
    const key = u.replace(/\/$/, '')
    if (urlOwner[key] === undefined) {
      urlOwner[key] = i
      urls.push(u)
    }
  })

  const extracted = await tavilyExtract(urls, counters)
  const textByDeal: Record<number, string> = {}
  const needFetch: number[] = []
  urls.forEach(u => {
    const i = urlOwner[u.replace(/\/$/, '')]
    const text = extracted[u.replace(/\/$/, '')]
    if (text) textByDeal[i] = text
    else needFetch.push(i)
  })
  await Promise.all(needFetch.map(async i => {
    const text = await plainFetchArticle(finalUrls[i] as string, counters)
    if (text) textByDeal[i] = text
  }))

  const articles = deals
    .map((d, i) => ({ id: i + 1, title: d.title, text: textByDeal[i] ?? '' }))
    .filter(a => a.text)
  counters.articleText = articles.length

  const facts = await extractDealFacts(articles, counters, deadlineAt - Date.now())
  articles.forEach(a => {
    const i = a.id - 1
    const raw = facts[a.id]
    if (!raw) return
    const validated = validateDealExtraction(raw, a.text)
    if (!validated.buyer && !validated.target && !validated.deal_size && !validated.rationale) return
    drafts[i] = dealEvidenceEntry({
      item: deals[i],
      finalUrl: finalUrls[i],
      extraction: validated,
    }) as EvidenceDraft
  })
  // Deals with a real URL but no usable text still point readers at the publisher page.
  deals.forEach((d, i) => {
    if (drafts[i].type === 'headline_only' && finalUrls[i]) {
      drafts[i] = { ...drafts[i], url: finalUrls[i] }
    }
  })
}

// ── Sector research ────────────────────────────────────────────────────────────

type ResearchQuery = { type: EvidenceType; query: string }

function researchQueries(sector: string, geography: string): ResearchQuery[] {
  const year = new Date().getFullYear()
  return [
    { type: 'research_regulation', query: `${sector} ${geography} regulator licensing rules regulation` },
    { type: 'research_acquirers', query: `${sector} ${geography} main acquirers investors private equity strategic buyers` },
    { type: 'research_transactions', query: `${sector} ${geography} recent acquisitions transactions deals ${year - 1} ${year}` },
  ]
}

async function runResearch(
  queries: ResearchQuery[],
  slots: EvidenceDraft[][],
  counters: Counters,
): Promise<boolean> {
  if (!process.env.TAVILY_API_KEY) return false
  const client = tavily({ apiKey: process.env.TAVILY_API_KEY })
  counters.searchCalls += queries.length
  await Promise.all(queries.map(async (q, i) => {
    const results: TavilyResult[] = await runSearch(client, q.query)
    slots[i] = searchResultEntries(results, q.type) as EvidenceDraft[]
  }))
  return true
}

// ── Supabase cache (sector + geography + day) ──────────────────────────────────

function sbHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!process.env.SUPABASE_URL || !key) return null
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function readCache(sector: string, geography: string, day: string): Promise<EvidenceDraft[] | null> {
  const headers = sbHeaders()
  if (!headers) return null
  try {
    const params = new URLSearchParams({ select: 'result', sector: `eq.${sector}`, geography: `eq.${geography}`, day: `eq.${day}`, limit: '1' })
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/evidence_cache?${params}`, { headers, signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const rows = (await res.json()) as { result: EvidenceDraft[] }[]
    return Array.isArray(rows[0]?.result) ? rows[0].result : null
  } catch {
    return null
  }
}

async function writeCache(sector: string, geography: string, day: string, result: EvidenceDraft[]): Promise<void> {
  const headers = sbHeaders()
  if (!headers) return
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/evidence_cache?on_conflict=sector,geography,day`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ sector, geography, day, result }),
      signal: AbortSignal.timeout(3000),
    })
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/evidence_cache?day=lt.${cutoff}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function buildEvidence(input: EvidenceInput): Promise<EvidenceResult> {
  const startedAt = Date.now()
  const deadlineAt = startedAt + TOTAL_BUDGET_MS
  const remaining = () => deadlineAt - Date.now()
  const counters: Counters = { searchCalls: 0, extractCalls: 0, extractUrls: 0, plainFetches: 0, geminiCalls: 0, gnTotal: 0, gnResolved: 0, articleText: 0 }

  const deals = pickDeals(input.dealItems ?? [])
  // Start every deal as headline-only so a timeout still returns something honest.
  const dealDrafts: EvidenceDraft[] = deals.map(d => dealEvidenceEntry({ item: d, finalUrl: null, extraction: null }) as EvidenceDraft)

  const day = new Date().toISOString().slice(0, 10)
  const queries = researchQueries(input.sector, input.geography)
  const researchSlots: EvidenceDraft[][] = queries.map(() => [])
  const researchState: { cache: EvidenceStats['research_cache']; complete: boolean } = { cache: 'skipped', complete: false }

  const researchTask = (async () => {
    const cached = await readCache(input.sector, input.geography, day)
    if (cached) {
      researchState.cache = 'hit'
      researchSlots[0] = cached
      researchState.complete = true
      return
    }
    researchState.cache = 'miss'
    researchState.complete = await runResearch(queries, researchSlots, counters)
  })()

  const dealTask = runDealPipeline(deals, dealDrafts, counters, deadlineAt)

  await Promise.all([
    withDeadline(dealTask, remaining(), () => undefined),
    withDeadline(researchTask, remaining(), () => undefined),
  ])
  const timedOut = remaining() <= 0

  const research = researchSlots.reduce<EvidenceDraft[]>((all, slot) => all.concat(slot), [])
  if (researchState.cache === 'miss' && researchState.complete && !timedOut && research.length > 0) {
    void writeCache(input.sector, input.geography, day, research)
  }

  const entries = numberEntries([
    ...dealDrafts,
    ...research,
    ...(benchmarkEntries(input.marketContext) as EvidenceDraft[]),
  ]) as EvidenceEntry[]

  const stats: EvidenceStats = {
    deals_considered: deals.length,
    deals_with_article_text: counters.articleText,
    google_news_links: counters.gnTotal,
    google_news_resolved: counters.gnResolved,
    tavily_search_calls: counters.searchCalls,
    tavily_extract_calls: counters.extractCalls,
    tavily_extract_urls: counters.extractUrls,
    plain_fetches: counters.plainFetches,
    gemini_calls: counters.geminiCalls,
    research_cache: researchState.cache,
    elapsed_ms: Date.now() - startedAt,
    timed_out: timedOut,
  }
  console.log('[evidence]', JSON.stringify(stats))
  return { entries, stats }
}
