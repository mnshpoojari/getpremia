import { GoogleGenerativeAI } from '@google/generative-ai'
import type { MarketContextResult } from './marketContext'

export type ContextSource = { title: string; url: string; source: string; date: string; content?: string }
export type PrimerClaim = { text: string; sourceIds: number[] }
export type PrimerSection = { key: string; title: string; claims: PrimerClaim[] }
export type ContextTimelineItem = ContextSource & { tier: 'Tracked deal' | 'Regional context' | 'Adjacent context'; tag?: string }
type ContextPolicyItem = { title: string; url: string; published_date: string; source: string; tag?: string }
type ContextLaneItem = ContextPolicyItem
export type SectorContext = {
  primer: PrimerSection[]
  sources: { id: number; title: string; url: string; source: string; date: string }[]
  timeline: ContextTimelineItem[]
  searchSummary: string
  searchedSteps: string[]
  indicators: { label: string; value: string; year: string; geography: string; source: string; url: string }[]
}

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT = 1100

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function field(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return match ? decodeXml(match[1]).trim() : ''
}

function hostName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Google News' }
}

async function googleNews(query: string, lang: string, country: string, editions: string) {
  const params = new URLSearchParams({ q: query, hl: lang, gl: country, ceid: editions })
  try {
    const response = await fetch(`https://news.google.com/rss/search?${params}`, {
      headers: { 'User-Agent': 'Premia sector research/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      next: { revalidate: 86400 },
    })
    if (!response.ok) return []
    const xml = await response.text()
    return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi), match => {
      const item = match[1]
      const title = field(item, 'title')
      const url = field(item, 'link')
      const pubDate = field(item, 'pubDate')
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)
      const published = pubDate ? new Date(pubDate) : null
      const description = field(item, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return { title, url, source: sourceMatch ? decodeXml(sourceMatch[1]).trim() : hostName(url), date: published && Number.isFinite(published.getTime()) ? published.toISOString().slice(0, 10) : '', content: description }
    }).filter(item => item.title && item.url && item.date)
  } catch { return [] }
}

type FeedNews = Awaited<ReturnType<typeof googleNews>>[number] & { tier?: 'Regional context' | 'Adjacent context'; tag?: string }

const REGIONAL_QUERIES: Record<string, { country: string; lang: string; edition: string; query: string }[]> = {
  'southeast asia': [
    { country: 'SG', lang: 'en-SG', edition: 'SG:en', query: 'logistics freight warehouse port investment' },
    { country: 'ID', lang: 'id-ID', edition: 'ID:id', query: 'logistik pergudangan pelabuhan investasi' },
    { country: 'VN', lang: 'vi-VN', edition: 'VN:vi', query: 'logistics kho vận cảng đầu tư' },
    { country: 'TH', lang: 'th-TH', edition: 'TH:th', query: 'โลจิสติกส์ คลังสินค้า ท่าเรือ ลงทุน' },
    { country: 'MY', lang: 'ms-MY', edition: 'MY:ms', query: 'logistik gudang pelabuhan pelaburan' },
    { country: 'PH', lang: 'en-PH', edition: 'PH:en', query: 'logistics warehouse port investment' },
  ],
  india: [{ country: 'IN', lang: 'hi-IN', edition: 'IN:hi', query: 'रक्षा एयरोस्पेस निवेश अधिग्रहण' }],
}

const OFFICIAL_POLICY_DOMAINS: Record<string, string[]> = {
  'southeast asia': ['asean.org', 'gov.sg', 'go.id', 'gov.vn', 'go.th', 'gov.my', 'gov.ph'],
  india: ['pib.gov.in', 'mod.gov.in', 'commerce.gov.in', 'investindia.gov.in'],
  singapore: ['gov.sg'], indonesia: ['go.id'], vietnam: ['gov.vn'], thailand: ['go.th'], malaysia: ['gov.my'], philippines: ['gov.ph'],
  'united states': ['.gov'], 'united kingdom': ['gov.uk'], australia: ['gov.au'], canada: ['canada.ca'], germany: ['bund.de'], france: ['gouv.fr'], japan: ['go.jp'],
}

function queryProfile(sector: string, geography: string) {
  const key = sector.toLowerCase()
  const geo = geography.toLowerCase()
  const synonyms = key.includes('logistic') ? 'supply chain freight forwarding last mile warehousing cold chain 3PL' : key.includes('defen') || key.includes('aerospace') ? 'defence aerospace aircraft military manufacturing' : key.includes('energy') ? 'renewable power electricity energy transition' : `${sector} investment companies market`
  const policy = key.includes('logistic') ? 'transport infrastructure logistics policy ports trade' : key.includes('defen') ? 'defence procurement budget indigenisation export policy' : key.includes('energy') ? 'energy policy regulation infrastructure' : `${sector} policy regulation investment`
  return { synonyms, policy, geo }
}

function localQueriesFor(sector: string, geography: string) {
  const base = REGIONAL_QUERIES[geography.toLowerCase()] ?? []
  const normalized = sector.toLowerCase()
  const localTerms = normalized.includes('logistic') || normalized.includes('supply chain')
    ? ['logistics freight warehousing port investment', 'logistik pergudangan pelabuhan investasi', 'logistics kho vận cảng đầu tư', 'โลจิสติกส์ คลังสินค้า ท่าเรือ ลงทุน', 'logistik gudang pelabuhan pelaburan', 'logistics warehouse port investment']
    : normalized.includes('defen') || normalized.includes('aerospace')
      ? ['defence aerospace investment', 'pertahanan dirgantara investasi', 'quốc phòng hàng không đầu tư', 'กลาโหม การบิน ลงทุน', 'pertahanan aeroangkasa pelaburan', 'defence aerospace investment']
      : normalized.includes('energy')
        ? ['energy electricity investment', 'energi listrik investasi', 'năng lượng điện đầu tư', 'พลังงาน ไฟฟ้า ลงทุน', 'tenaga elektrik pelaburan', 'energy electricity investment']
        : [`${sector} investment company`, `${sector} investasi perusahaan`, `${sector} đầu tư doanh nghiệp`, `${sector} ลงทุน บริษัท`, `${sector} pelaburan syarikat`, `${sector} investment company`]
  return base.map((item, index) => ({ ...item, query: localTerms[index] ?? item.query }))
}

async function cachedContext(sector: string, geography: string): Promise<SectorContext | null> {
  if (!SB_URL || !SB_KEY) return null
  const key = `sector-context:${sector}`
  const params = new URLSearchParams({ select: 'result,fetched_at', sector: `eq.${key}`, geography: `eq.${geography}`, limit: '1' })
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_context_cache?${params}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(1800), cache: 'no-store' })
    const rows = res.ok ? await res.json() as { result: SectorContext; fetched_at: string }[] : []
    const row = rows[0]
    return row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_MAX_AGE ? row.result : null
  } catch { return null }
}

async function cacheContext(sector: string, geography: string, result: SectorContext) {
  if (!SB_URL || !SB_KEY) return
  const key = `sector-context:${sector}`
  try {
    await fetch(`${SB_URL}/rest/v1/market_context_cache`, {
      method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ sector: key, geography, result, fetched_at: new Date().toISOString() }), signal: AbortSignal.timeout(1800), cache: 'no-store',
    })
  } catch { /* cache is an optimization; search results remain usable */ }
}

async function buildPrimer(sector: string, geography: string, market: MarketContextResult | null, newsSources: ContextSource[]): Promise<PrimerSection[]> {
  const datedSources = [
    ...primerSources(market).filter(source => source.date && source.url),
    ...newsSources.filter(source => source.date && source.url && source.content).map(source => ({ ...source, content: source.content ?? '' })),
  ].filter((source, index, all) => all.findIndex(candidate => candidate.url === source.url) === index).slice(0, 18).map((source, index) => ({ ...source, id: index + 1 }))
  if (datedSources.length < 2 || !process.env.GEMINI_API_KEY) return []
  const instructions = `Write a factual, cited sector primer for ${sector} in ${geography}. Use only the dated source excerpts and benchmark values below. Return JSON only: {"sections":[{"key":"what_it_is|size_and_growth|structure|activity|drivers|risks|regulation","title":"...","claims":[{"text":"one concise factual sentence","sourceIds":[1]}]}]}. Aim for at least four of the seven sections, and cover all seven only when the supplied sources support them. Every claim must cite one or more valid sourceIds. If geography is a multi-country region, include country-level activity only when a supplied source supports it. Do not infer from missing data, estimate values, or state a trend without direct evidence. Never call a sector quiet or inactive. Omit unsupported claims.

Benchmarks (use only when the corresponding source excerpt supports it): ${JSON.stringify(datedSources.filter(source => source.title === 'Market size benchmark' || source.title === 'CAGR benchmark').map(source => ({ id: source.id, title: source.title, date: source.date, source: source.source, excerpt: source.content })))}
Sources: ${JSON.stringify(datedSources.map(s => ({ id: s.id, source: s.source, date: s.date, title: s.title, excerpt: (s.content ?? '').slice(0, 600) })))} `
  try {
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
    let sections: PrimerSection[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = `${instructions}\n${attempt ? `The previous draft had ${sections.length} valid sections. Retry to provide four supported sections if possible; omit unsupported claims.\n` : ''}`
      const response = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('primer timeout')), 3000)),
      ])
      const raw = response.response.text().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
      const parsed = JSON.parse(raw) as { sections?: PrimerSection[] }
      sections = (parsed.sections ?? []).map(section => ({
        key: section.key,
        title: section.title,
        claims: (section.claims ?? []).filter(claim => claim.text && !/\b(?:quiet|inactive)\b/i.test(claim.text) && claim.sourceIds?.length && claim.sourceIds.every(id => Number.isInteger(id) && id >= 1 && id <= datedSources.length)).slice(0, 4),
      })).filter(section => section.claims.length > 0 && ['what_it_is', 'size_and_growth', 'structure', 'activity', 'drivers', 'risks', 'regulation'].includes(section.key)).slice(0, 7)
      if (sections.length >= 4) break
    }
    return sections
  } catch (error) {
    console.warn('[sector-primer] unavailable:', error instanceof Error ? error.message : String(error))
    return []
  }
}

async function fetchIndicators(geography: string, sector: string) {
  const countries: Record<string, string> = { India: 'IND', 'United States': 'USA', 'United Kingdom': 'GBR', Singapore: 'SGP', Indonesia: 'IDN', Vietnam: 'VNM', Thailand: 'THA', Malaysia: 'MYS', Philippines: 'PHL', Germany: 'DEU', France: 'FRA', Japan: 'JPN' }
  const country = countries[geography]
  const region = geography.toLowerCase() === 'southeast asia'
  const countryCodes = region ? ['SGP', 'IDN', 'VNM', 'THA', 'MYS', 'PHL'] : country ? [country] : []
  if (!countryCodes.length) return []
  const normalizedSector = sector.toLowerCase()
  const definitions = normalizedSector.includes('logistic') || normalizedSector.includes('supply chain')
    ? [{ code: 'LP.LPI.OVRL.XQ', label: 'Logistics Performance Index' }, { code: 'NE.TRD.GNFS.ZS', label: 'Trade (% of GDP)' }, { code: 'IT.NET.USER.ZS', label: 'Internet use (% of population)' }]
    : normalizedSector.includes('defen') || normalizedSector.includes('aerospace')
      ? [{ code: 'MS.MIL.XPND.GD.ZS', label: 'Military expenditure (% of GDP)' }, { code: 'MS.MIL.XPND.CD', label: 'Military expenditure (current US$)' }, { code: 'TX.VAL.MRCH.CD.WT', label: 'Merchandise exports (current US$)' }]
      : normalizedSector.includes('energy')
        ? [{ code: 'EG.ELC.RNEW.ZS', label: 'Renewable electricity (% of total)' }, { code: 'EG.FEC.RNEW.ZS', label: 'Renewable energy (% of total use)' }, { code: 'EG.USE.ELEC.KH.PC', label: 'Electricity use per capita' }]
        : [{ code: 'NY.GDP.MKTP.CD', label: 'GDP (current US$)' }, { code: 'NE.TRD.GNFS.ZS', label: 'Trade (% of GDP)' }, { code: 'IT.NET.USER.ZS', label: 'Internet use (% of population)' }]
  const results = await Promise.all(definitions.map(async item => {
    try {
      const response = await fetch(`https://api.worldbank.org/v2/country/${countryCodes.join(';')}/indicator/${item.code}?format=json&per_page=100&date=2015:2026`, { signal: AbortSignal.timeout(2200), next: { revalidate: 86400 } })
      const json = await response.json() as [unknown, { date: string; value: number | null; country?: { value?: string }; countryiso3code?: string }[]]
      const rows = (json?.[1] ?? []).filter(row => row.value != null)
      if (!rows.length) return null
      const values = countryCodes.map(code => {
        const row = rows.find(candidate => candidate.countryiso3code === code)
        if (!row || row.value == null) return null
        const value = item.code === 'NY.GDP.MKTP.CD' || item.code === 'MS.MIL.XPND.CD' || item.code === 'TX.VAL.MRCH.CD.WT'
          ? `$${(row.value / 1e9).toFixed(1)}bn`
          : item.code === 'EG.USE.ELEC.KH.PC' ? `${row.value.toLocaleString()} kWh/person` : `${row.value.toFixed(1)}${item.code === 'LP.LPI.OVRL.XQ' ? ' / 5' : '%'}`
        return { countryName: row.country?.value ?? code, value, year: row.date }
      }).filter((row): row is NonNullable<typeof row> => row !== null)
      if (!values.length) return null
      const years = values.map(row => Number(row.year)).filter(Number.isFinite)
      return {
        label: item.label,
        value: region ? values.map(row => `${row.countryName} ${row.value}`).join(' · ') : values[0].value,
        year: region && years.length ? `Latest by country (${Math.min(...years)}–${Math.max(...years)})` : values[0].year,
        geography: region ? 'Southeast Asia · country values shown individually' : geography,
        source: 'World Bank',
        url: `https://data.worldbank.org/indicator/${item.code}?locations=${countryCodes.join(',')}`,
      }
    } catch { return null }
  }))
  return results.filter((item): item is NonNullable<typeof item> => item !== null).slice(0, 4)
}

function classifyPolicy(title: string) {
  const text = title.toLowerCase()
  return /budget|appropriation|spending|outlay/.test(text) ? 'Budget'
    : /procure|tender|contract|order/.test(text) ? 'Procurement'
      : /export/.test(text) ? 'Exports'
        : /fd i|foreign investment|regulat|rule|law|policy/.test(text) ? 'FDI/Regulation'
          : 'Indigenisation'
}

export async function getSectorContext(params: {
  sector: string
  geography: string
  market: MarketContextResult | null
  trackedDeals: { title: string; url: string; published_date: string; source: string }[]
  policyItems?: ContextPolicyItem[]
  filingItems?: ContextLaneItem[]
  startupItems?: ContextLaneItem[]
}): Promise<SectorContext> {
  const cached = await cachedContext(params.sector, params.geography)
  if (cached) {
    const nowMs = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000
    const tracked = params.trackedDeals.filter(item => new Date(item.published_date).getTime() >= nowMs).map(item => ({ title: item.title, url: item.url, source: item.source || hostName(item.url), date: item.published_date.slice(0, 10), tier: 'Tracked deal' as const }))
    const policy = (params.policyItems ?? []).filter(item => item.title && item.url && item.source && Number.isFinite(new Date(item.published_date).getTime())).map(item => ({ title: item.title, url: item.url, source: item.source, date: item.published_date.slice(0, 10), tier: 'Regional context' as const, tag: item.tag || classifyPolicy(item.title) }))
    const laneItems = [...(params.filingItems ?? []).map(item => ({ ...item, tag: 'Filing' })), ...(params.startupItems ?? []).map(item => ({ ...item, tag: 'Startup tracker' }))]
      .filter(item => item.title && item.url && item.source && Number.isFinite(new Date(item.published_date).getTime()))
      .map(item => ({ title: item.title, url: item.url, source: item.source, date: item.published_date.slice(0, 10), tier: 'Regional context' as const, tag: item.tag }))
    return { ...cached, timeline: [...tracked, ...policy, ...laneItems, ...cached.timeline.filter(item => item.tier !== 'Tracked deal')].filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15) }
  }

  const profile = queryProfile(params.sector, params.geography)
  const steps: string[] = ['tracked sources (90d)']
  const now = new Date()
  const after = new Date(now); after.setFullYear(after.getFullYear() - 2)
  const before = new Date(now); before.setDate(before.getDate() - 90)
  const time = `after:${after.toISOString().slice(0, 10)} before:${before.toISOString().slice(0, 10)}`
  const region = params.geography.toLowerCase() === 'southeast asia' ? 'ASEAN Asia Pacific' : params.geography
  let news: FeedNews[] = []
  let searchedQueryCount = 0
  const merge = (...batches: Awaited<ReturnType<typeof googleNews>>[]) => {
    const seen = new Set<string>()
    return batches.flat().filter(item => {
      if (!item.url || seen.has(item.url)) return false
      seen.add(item.url); return true
    })
  }
  const mergeTagged = (existing: FeedNews[], incoming: FeedNews[], tier: 'Regional context' | 'Adjacent context') => {
    const priorUrls = new Set(existing.map(item => item.url))
    return [...existing, ...incoming.filter(item => !priorUrls.has(item.url)).map(item => ({ ...item, tier }))]
  }

  // Tracked deal records are step one (90 days, exact geography). Keep the
  // wider background search separate so none of it can affect classification.
  const trackedRecentCount = params.trackedDeals.filter(item => {
    const date = new Date(item.published_date).getTime()
    return Number.isFinite(date) && date >= before.getTime() && date <= now.getTime()
  }).length
  if (trackedRecentCount >= 5) {
    steps.push('widening stopped (5+ exact-geography tracked items)')
  } else {
  const exact = await Promise.all([
    googleNews(`${params.sector} ${params.geography} ${time}`, 'en-US', 'US', 'US:en'),
    googleNews(`${params.sector} ${params.geography} investment policy ${time}`, 'en-US', 'US', 'US:en'),
  ])
  searchedQueryCount += 2
  steps.push('same sources (12–24 months)')
  news = mergeTagged(news, merge(...exact), 'Regional context')
  if (news.length < 5) {
    const wide = await Promise.all([
      googleNews(`${params.sector} ${params.geography} deals funding acquisition ${time}`, 'en-US', 'US', 'US:en'),
      googleNews(`${params.sector} ${params.geography} ${profile.synonyms} ${time}`, 'en-US', 'US', 'US:en'),
    ])
    searchedQueryCount += 2; news = merge(news, ...wide)
  }
  if (news.length < 5) {
    steps.push('parent region')
    const regionalQueries = [
      googleNews(`${params.sector} ${region} investment funding acquisition ${time}`, 'en-US', 'US', 'US:en'),
      ...(params.geography.toLowerCase() === 'southeast asia'
        ? ['Singapore', 'Indonesia', 'Vietnam', 'Thailand', 'Malaysia', 'Philippines'].map(country => googleNews(`${params.sector} ${country} company investment acquisition policy ${time}`, 'en-US', 'US', 'US:en'))
        : []),
    ]
    const domains = OFFICIAL_POLICY_DOMAINS[params.geography.toLowerCase()] ?? []
    steps.push(domains.length ? 'official regional policy sources' : 'official-source search')
    const officialQueries = domains.length
      ? domains.slice(0, 4).map(domain => googleNews(`site:${domain} ${params.sector} policy investment procurement budget ${time}`, 'en-US', 'US', 'US:en'))
      : [googleNews(`site:gov ${params.sector} ${params.geography} policy investment procurement budget ${time}`, 'en-US', 'US', 'US:en')]
    const [official, regional] = await Promise.all([
      Promise.all(officialQueries),
      Promise.all(regionalQueries),
    ])
    searchedQueryCount += regional.length + official.length
    const officialItems = merge(...official).map(item => ({ ...item, tag: domains.length ? undefined : 'Official source' }))
    news = mergeTagged(news, [...merge(...regional), ...officialItems], 'Regional context')
  }
  if (news.length < 5) {
    steps.push('adjacent sub-sectors and synonyms')
    const adjacent = await googleNews(`${profile.synonyms} ${params.geography} ${time}`, 'en-US', 'US', 'US:en')
    searchedQueryCount++; news = mergeTagged(news, adjacent, 'Adjacent context')
  }
  if (news.length < 5) {
    steps.push('company-level news')
    const companies = params.trackedDeals.slice(0, 4).map(deal => deal.title.split(/\b(?:acquires?|acquired|raises?|raised|for|to)\b/i)[0].trim()).filter(name => name.length > 2).slice(0, 3)
    const batches = await Promise.all(companies.length
      ? companies.map(name => googleNews(`"${name}" ${time}`, 'en-US', 'US', 'US:en'))
      : [googleNews(`${params.sector} largest companies ${params.geography} news ${time}`, 'en-US', 'US', 'US:en')])
    searchedQueryCount += batches.length; news = mergeTagged(news, merge(...batches), 'Regional context')
  }
  if (news.length < 5) {
    const localQueries = localQueriesFor(params.sector, params.geography)
    if (localQueries.length) {
      steps.push('local-language queries')
      const local = await Promise.all(localQueries.map(item => googleNews(`${item.query} ${time}`, item.lang, item.country, item.edition)))
      searchedQueryCount += localQueries.length; news = mergeTagged(news, merge(...local), 'Regional context')
    }
  }
  }

  const oldestAllowed = after.getTime()
  const tracked: ContextTimelineItem[] = params.trackedDeals.filter(item => {
    const date = new Date(item.published_date).getTime()
    return Number.isFinite(date) && date >= oldestAllowed && date <= now.getTime()
  }).map(item => ({ title: item.title, url: item.url, source: item.source || hostName(item.url), date: item.published_date.slice(0, 10), tier: 'Tracked deal' }))
  const timelineNews: ContextTimelineItem[] = news.filter(item => {
    const date = new Date(item.date).getTime()
    return Number.isFinite(date) && date >= oldestAllowed && date <= now.getTime()
  }).slice(0, 12).map(item => ({ ...item, tier: item.tier ?? 'Regional context', tag: item.tag ?? (/policy|budget|government|ministry|regulation|procurement|port|infrastructure/i.test(item.title) ? classifyPolicy(item.title) : item.tier ?? 'Regional context') }))

  const policyTimeline: ContextTimelineItem[] = (params.policyItems ?? []).filter(item => item.title && item.url && item.source && Number.isFinite(new Date(item.published_date).getTime()))
    .map(item => ({ title: item.title, url: item.url, source: item.source, date: item.published_date.slice(0, 10), tier: 'Regional context', tag: item.tag || classifyPolicy(item.title) }))

  const laneTimeline: ContextTimelineItem[] = [...(params.filingItems ?? []).map(item => ({ ...item, tag: 'Filing' })), ...(params.startupItems ?? []).map(item => ({ ...item, tag: 'Startup tracker' }))]
    .filter(item => item.title && item.url && item.source && Number.isFinite(new Date(item.published_date).getTime()))
    .map(item => ({ title: item.title, url: item.url, source: item.source, date: item.published_date.slice(0, 10), tier: 'Regional context', tag: item.tag }))

  const contextSources = params.market?.research_sources ?? []
  if (contextSources.length) steps.push('benchmarks and market research')
  if (params.filingItems?.length) steps.push('exchange filings')
  if (params.startupItems?.length) steps.push('startup funding trackers')
  const newsSources = [...timelineNews, ...policyTimeline, ...laneTimeline].map(item => ({ title: item.title, url: item.url, source: item.source, date: item.date, content: item.content }))
  const [primer, indicators] = await Promise.all([
    buildPrimer(params.sector, params.geography, params.market, newsSources),
    fetchIndicators(params.geography, params.sector),
  ])
  if (indicators.length) steps.push('public indicators')
  const externalCount = timelineNews.length + policyTimeline.length + laneTimeline.length
  const laneTag = externalCount ? `${externalCount} regional/adjacent items` : 'no regional/adjacent items'
  const searchSummary = `Searched: ${steps.join(', ')}. Found ${laneTag}.${searchedQueryCount ? ` ${searchedQueryCount} free RSS queries.` : ''}`
  const sources = [...primerSources(params.market).filter(source => source.date && source.url), ...newsSources.filter(source => source.date && source.url && source.content)]
    .filter((source, index, all) => all.findIndex(candidate => candidate.url === source.url) === index)
    .slice(0, 18).map((source, index) => ({ id: index + 1, title: source.title, url: source.url, source: source.source, date: source.date as string }))
  const result = { primer, sources, timeline: [...tracked, ...timelineNews, ...policyTimeline, ...laneTimeline].filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15), searchSummary, searchedSteps: steps, indicators }
  void cacheContext(params.sector, params.geography, result)
  return result
}

export function primerSources(market: MarketContextResult | null) {
  const rows = [...(market?.research_sources ?? [])]
  if (market?.market_size.value != null && market.market_size.source_url) rows.push({ title: 'Market size benchmark', url: market.market_size.source_url, source: market.market_size.source_name ?? hostName(market.market_size.source_url), date: market.market_size.year ? String(market.market_size.year) : null, content: `${market.market_size.value} billion USD market size for ${market.market_size.geography_scope ?? 'the stated geography'}` })
  if (market?.cagr.value != null && market.cagr.source_url) rows.push({ title: 'CAGR benchmark', url: market.cagr.source_url, source: market.cagr.source_name ?? hostName(market.cagr.source_url), date: market.cagr.period ?? null, content: `${market.cagr.value}% CAGR over ${market.cagr.period ?? 'the stated period'} for ${market.cagr.geography_scope ?? 'the stated geography'}` })
  return rows.filter(source => source.date && source.url).map((source, index) => ({ id: index + 1, ...source, date: source.date as string }))
}
