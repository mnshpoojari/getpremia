import { createHash } from 'crypto'
import { tavily } from '@tavily/core'
import { callModel, MODELS } from './config'
import { timed } from './timing'
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
  | 'research_structure'
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
  deals_from_facts_cache: number
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
const TOTAL_BUDGET_MS = 3_000
const PREFETCH_MIN_MS_FOR_EXTRACTION = 800
const MAX_EXTRACT_CALLS = 8
const MAX_EXTRACT_URLS = 8
const FETCH_TIMEOUT_MS = 6_000
const RESOLVE_TIMEOUT_MS = 8_000
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
  if (articles.length === 0 || !process.env.GEMINI_API_KEY || msLeft < PREFETCH_MIN_MS_FOR_EXTRACTION) return {}
  counters.geminiCalls++
  try {
    const result = await timed('evidence_gemini', () => withDeadline(
      callModel(MODELS.extraction, buildExtractionPrompt(articles), { json: true, temperature: 0, label: 'extraction' }).catch(err => {
        console.warn('[evidence] gemini call error:', err instanceof Error ? err.message.slice(0, 300) : String(err))
        return ''
      }),
      msLeft,
      () => '',
    ))
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
): Promise<DealFactsRow[]> {
  const finalUrls = await timed('evidence_resolve', () => Promise.all(deals.map(d => resolveDealUrl(d.url, counters))))

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

  const extracted = await timed('evidence_tavily_extract', () => tavilyExtract(urls, counters))
  const textByDeal: Record<number, string> = {}
  const needFetch: number[] = []
  urls.forEach(u => {
    const i = urlOwner[u.replace(/\/$/, '')]
    const text = extracted[u.replace(/\/$/, '')]
    if (text) textByDeal[i] = text
    else needFetch.push(i)
  })
  await timed('evidence_plain_fetch', () => Promise.all(needFetch.map(async i => {
    const text = await plainFetchArticle(finalUrls[i] as string, counters)
    if (text) textByDeal[i] = text
  })))

  const articles = deals
    .map((d, i) => ({ id: i + 1, title: d.title, text: textByDeal[i] ?? '' }))
    .filter(a => a.text)
  counters.articleText += articles.length

  const facts = await extractDealFacts(articles, counters, deadlineAt - Date.now())
  const rows: DealFactsRow[] = []
  const queueRow = (i: number, result: DealFactsResult) => {
    const finalUrl = finalUrls[i] as string
    rows.push({ url_hash: hashUrl(finalUrl), url: finalUrl, result })
    if (deals[i].url && deals[i].url !== finalUrl) rows.push({ url_hash: hashUrl(deals[i].url), url: deals[i].url, result })
  }
  articles.forEach(a => {
    const i = a.id - 1
    const raw = facts[a.id]
    if (!raw) return
    const validated = validateDealExtraction(raw, a.text)
    queueRow(i, { facts: validated, final_url: finalUrls[i] })
    if (!validated.buyer && !validated.target && !validated.deal_size && !validated.rationale) return
    drafts[i] = dealEvidenceEntry({
      item: deals[i],
      finalUrl: finalUrls[i],
      extraction: validated,
    }) as EvidenceDraft
  })
  // Deals with a real URL but no usable text still point readers at the publisher page.
  deals.forEach((d, i) => {
    if (finalUrls[i] && !textByDeal[i]) queueRow(i, { no_text: true, final_url: finalUrls[i] })
    if (drafts[i].type === 'headline_only' && finalUrls[i]) {
      drafts[i] = { ...drafts[i], url: finalUrls[i] }
    }
  })
  return rows
}

// Reads the deal-facts cache first; only deals missing from it go through live resolve/extract.
async function loadDealEvidence(
  deals: EvidenceDealInput[],
  drafts: EvidenceDraft[],
  counters: Counters,
  deadlineAt: number,
  awaitWrite: boolean,
): Promise<{ cached: number }> {
  const cache = await timed('deal_facts_cache_read', () => readDealFacts(deals.map(d => hashUrl(d.url))))
  const pending: number[] = []
  deals.forEach((d, i) => {
    const hit = cache[hashUrl(d.url)]
    if (!hit) { pending.push(i); return }
    if (hit.facts) {
      counters.articleText++
      const f = hit.facts
      if (f.buyer || f.target || f.deal_size || f.rationale) {
        drafts[i] = dealEvidenceEntry({ item: d, finalUrl: hit.final_url ?? null, extraction: f }) as EvidenceDraft
        return
      }
    }
    if (hit.final_url) drafts[i] = { ...drafts[i], url: hit.final_url }
  })
  const cachedCount = deals.length - pending.length
  if (pending.length > 0) {
    const subDrafts = pending.map(i => drafts[i])
    const rows = await runDealPipeline(pending.map(i => deals[i]), subDrafts, counters, deadlineAt)
    pending.forEach((i, k) => { drafts[i] = subDrafts[k] })
    const write = writeDealFacts(rows)
    if (awaitWrite) await write
    else void write
  }
  return { cached: cachedCount }
}

// ── Sector research ────────────────────────────────────────────────────────────

type ResearchQuery = { type: EvidenceType; query: string }

function researchQueries(sector: string, geography: string): ResearchQuery[] {
  const year = new Date().getFullYear()
  return [
    { type: 'research_regulation', query: `${sector} ${geography} regulator licensing rules regulation` },
    { type: 'research_acquirers', query: `${sector} ${geography} main acquirers investors private equity strategic buyers` },
    { type: 'research_transactions', query: `${sector} ${geography} recent acquisitions transactions deals ${year - 1} ${year}` },
    { type: 'research_structure', query: `${sector} ${geography} industry overview how the sector works typical buyers sellers deal structure` },
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
  await timed('evidence_tavily_search', () => Promise.all(queries.map(async (q, i) => {
    const results: TavilyResult[] = await runSearch(client, q.query)
    slots[i] = searchResultEntries(results, q.type) as EvidenceDraft[]
  })))
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

// ── Supabase cache for deal facts (resolved article URL hash) ─────────────────

type DealFactsResult = { facts?: Record<string, string | null>; no_text?: boolean; final_url?: string | null }
type DealFactsRow = { url_hash: string; url: string; result: DealFactsResult }

function hashUrl(url: string): string {
  return createHash('sha256').update(String(url ?? '').trim().replace(/\/$/, '')).digest('hex')
}

async function readDealFacts(hashes: string[]): Promise<Record<string, DealFactsResult>> {
  const out: Record<string, DealFactsResult> = {}
  const headers = sbHeaders()
  const unique = Array.from(new Set(hashes.filter(Boolean)))
  if (!headers || unique.length === 0) return out
  try {
    const params = new URLSearchParams({ select: 'url_hash,result', url_hash: `in.(${unique.join(',')})` })
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/deal_facts_cache?${params}`, { headers, signal: AbortSignal.timeout(2500) })
    if (!res.ok) return out
    const rows = (await res.json()) as { url_hash: string; result: DealFactsResult }[]
    for (const r of rows) if (r?.url_hash && r.result) out[r.url_hash] = r.result
  } catch {
    // Cache read failure just means live extraction.
  }
  return out
}

async function writeDealFacts(rows: DealFactsRow[]): Promise<void> {
  const headers = sbHeaders()
  if (!headers || rows.length === 0) return
  try {
    const now = new Date().toISOString()
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/deal_facts_cache?on_conflict=url_hash`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.map(r => ({ ...r, created_at: now }))),
      signal: AbortSignal.timeout(3000),
    })
    const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/deal_facts_cache?created_at=lt.${cutoff}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function buildEvidence(input: EvidenceInput & { budgetMs?: number }): Promise<EvidenceResult> {
  const startedAt = Date.now()
  const deadlineAt = startedAt + Math.max(0, Math.min(TOTAL_BUDGET_MS, input.budgetMs ?? TOTAL_BUDGET_MS))
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

  const dealState = { cached: 0 }
  const dealTask = loadDealEvidence(deals, dealDrafts, counters, deadlineAt, false).then(r => { dealState.cached = r.cached })

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
    deals_from_facts_cache: dealState.cached,
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

// Resolves and extracts facts for the top deals during analyse, so the thesis step finds them cached.
// Awaited by the analyse route under its own cap; always writes the cache before returning and never throws.
export async function prefetchDealFacts(
  items: EvidenceDealInput[],
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<{ considered: number; from_cache: number; with_text: number }> {
  const none = { considered: 0, from_cache: 0, with_text: 0 }
  try {
    const deals = pickDeals(items ?? []).slice(0, opts.limit ?? 6)
    if (deals.length === 0) return none
    const counters: Counters = { searchCalls: 0, extractCalls: 0, extractUrls: 0, plainFetches: 0, geminiCalls: 0, gnTotal: 0, gnResolved: 0, articleText: 0 }
    const drafts: EvidenceDraft[] = deals.map(d => dealEvidenceEntry({ item: d, finalUrl: null, extraction: null }) as EvidenceDraft)
    const { cached } = await loadDealEvidence(deals, drafts, counters, Date.now() + (opts.budgetMs ?? 8_000), true)
    console.log('[deal-facts-prefetch]', JSON.stringify({ considered: deals.length, from_cache: cached, with_text: counters.articleText, tavily_extract_calls: counters.extractCalls, gemini_calls: counters.geminiCalls }))
    return { considered: deals.length, from_cache: cached, with_text: counters.articleText }
  } catch (err) {
    console.warn('[evidence] deal-facts prefetch failed:', err instanceof Error ? err.message.slice(0, 160) : String(err))
    return none
  }
}
// Warms the sector research cache (same key the thesis step reads). Awaited by the analyse route with its own timeout;
// it always writes the cache when the searches finish and never throws.
export async function prefetchSectorResearch(sector: string, geography: string): Promise<'hit' | 'filled' | 'skipped'> {
  try {
    if (!sector || !process.env.TAVILY_API_KEY) return 'skipped'
    const day = new Date().toISOString().slice(0, 10)
    if (await readCache(sector, geography, day)) return 'hit'
    const queries = researchQueries(sector, geography)
    const slots: EvidenceDraft[][] = queries.map(() => [])
    const counters: Counters = { searchCalls: 0, extractCalls: 0, extractUrls: 0, plainFetches: 0, geminiCalls: 0, gnTotal: 0, gnResolved: 0, articleText: 0 }
    const complete = await runResearch(queries, slots, counters)
    const research = slots.reduce<EvidenceDraft[]>((all, slot) => all.concat(slot), [])
    if (!complete || research.length === 0) return 'skipped'
    await writeCache(sector, geography, day, research)
    return 'filled'
  } catch (err) {
    console.warn('[evidence] prefetch failed:', err instanceof Error ? err.message.slice(0, 160) : String(err))
    return 'skipped'
  }
}


