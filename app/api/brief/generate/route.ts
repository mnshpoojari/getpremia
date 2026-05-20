import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Parser from 'rss-parser'

export const maxDuration = 60

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

// ── Feeds ──────────────────────────────────────────────────────────────────────

// Core PE/VC/M&A publications — high deal signal, no keyword filter
const TIER_1_FEEDS = [
  // Global PE/M&A
  'https://www.altassets.net/feed',
  'https://www.pehub.com/feed',
  'https://www.privateequityinternational.com/feed',
  'https://www.buyoutsinsider.com/feed',
  'https://www.privateequitywire.co.uk/feed',
  'https://www.finsmes.com/feed',
  // Asia / Emerging markets
  'https://www.dealstreetasia.com/feed',
  'https://www.vccircle.com/feed',        // India
  'https://e27.co/feed',                   // Southeast Asia
  'https://inc42.com/feed',                // India VC/startup
  'https://techcabal.com/feed',            // Africa
  'https://restofworld.org/feed',          // Global emerging markets
  'https://asia.nikkei.com/rss/feed/nar', // Japan/Asia
  // Europe
  'https://sifted.eu/feed',               // Europe VC
  'https://realdeals.eu.com/feed',         // Europe PE
  // Infrastructure & project finance
  'https://www.infrastructureinvestor.com/feed',
  // Startup funding
  'https://techcrunch.com/feed',
  // Korea
  'https://www.kedglobal.com/rss/allArticle',  // Korea Economic Daily
]

// Broad finance/business — deal keyword filter applied
const TIER_2_FEEDS = [
  'https://feeds.reuters.com/reuters/businessNews',
  'https://rss.nytimes.com/services/xml/rss/nyt/DealBook.xml',
  'https://www.axios.com/feeds/feed/markets.xml',
  'https://www.arabianbusiness.com/rss',
  'https://economictimes.indiatimes.com/markets/rss.cms',
  'https://www.finextra.com/rss/finextra-news.xml',  // Fintech deals
  'https://www.euractiv.com/feed',                    // Europe policy/deals
  'https://www.zawya.com/rss/world-business.rss',     // Middle East/GCC
  'https://www.thenationalnews.com/arc/outboundfeeds/rss/', // UAE/GCC
  'https://www.cbinsights.com/research/feed/',         // CB Insights research
  'https://seekingalpha.com/feed.xml',                 // Seeking Alpha — investment analysis
]

// Sector trade publications — deal keyword filter applied
// Sources where deal signals surface earliest, before mainstream press
const SECTOR_FEEDS = [
  // Climate & Energy
  'https://www.canarymedia.com/rss',
  'https://www.utilitydive.com/feeds/news',
  'https://www.rechargenews.com/rss',
  'https://carbon-pulse.com/feed',
  // Healthcare & Biotech
  'https://www.statnews.com/feed',
  'https://www.fiercebiotech.com/rss/xml',
  // Defence & Aerospace
  'https://www.defensenews.com/arc/outboundfeeds/rss',
  'https://breakingdefense.com/feed',
  // Supply Chain & Logistics
  'https://www.supplychaindive.com/feeds/news',
]

// Macro-economic feeds — no deal keyword filter applied
const MACRO_FEEDS = [
  'https://feeds.reuters.com/reuters/companyNews',
  'https://feeds.ft.com/rss/home/uk',
  'https://economictimes.indiatimes.com/markets/commodities/rss.cms',
  'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
  'https://www.wsj.com/xml/rss/3_7014.xml',
  'https://www.technologyreview.com/feed',  // MIT Tech Review — AI/deep tech macro
]

const TIER_3_QUERIES = [
  'private equity acquisition 2025',
  'M&A deal acquisition majority stake 2025',
  'strategic acquisition buyout 2025',
  'take private deal 2025',
  '"sovereign wealth fund" OR "family office" acquisition 2025',
  '"private equity" OR "growth equity" investment stake 2025',
  'infrastructure project finance deal 2025',
  '"venture capital" India OR Africa OR "Southeast Asia" funding 2025',
]

// Macro-economic Google News queries
const MACRO_QUERIES = [
  'gold price inflation 2025',
  'interest rate decision Federal Reserve ECB RBI 2025',
  'oil price OPEC crude 2025',
  'inflation CPI data 2025',
  'bond yield treasury 2025',
  'currency dollar rupee euro 2025',
]

const DEAL_KEYWORDS = [
  'acquires', 'acquisition', 'takes stake', 'majority stake',
  'buyout', 'take private', 'merger', 'carve-out', 'divestiture',
  'strategic review', 'sale process', 'capital injection',
  'going private', 'spin-off', 'invested in', 'portfolio company',
]

// ── Supabase helpers ───────────────────────────────────────────────────────────

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  }
}

async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbUpsert(table: string, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
  if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${await res.text()}`)
}

// ── Feed fetching ──────────────────────────────────────────────────────────────

interface RawItem {
  title: string
  url: string
  source: string
  pub: Date
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function hasDealKeyword(text: string): boolean {
  const t = text.toLowerCase()
  return DEAL_KEYWORDS.some(kw => t.includes(kw))
}

async function fetchFeed(url: string, requireDealKeyword: boolean): Promise<RawItem[]> {
  try {
    const parser = new Parser({ timeout: 6000 })
    const feed = await parser.parseURL(url)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return feed.items
      .filter(item => item.title && item.link)
      .filter(item => !requireDealKeyword || hasDealKeyword(item.title!))
      .map(item => ({
        title: item.title!,
        url: item.link!,
        source: feed.title ?? extractDomain(item.link!),
        pub: item.pubDate ? new Date(item.pubDate) : new Date(),
      }))
      .filter(item => item.pub >= cutoff)
  } catch {
    return []
  }
}

async function fetchAllItems(): Promise<{ deal: RawItem[]; macro: RawItem[] }> {
  const dealFeeds: [string, boolean][] = [
    ...TIER_1_FEEDS.map(u => [u, false] as [string, boolean]),
    ...TIER_2_FEEDS.map(u => [u, true] as [string, boolean]),
    ...SECTOR_FEEDS.map(u => [u, true] as [string, boolean]),
    ...TIER_3_QUERIES.map(q => [
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
      false,
    ] as [string, boolean]),
  ]

  const macroFeeds: [string, boolean][] = [
    ...MACRO_FEEDS.map(u => [u, false] as [string, boolean]),
    ...MACRO_QUERIES.map(q => [
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
      false,
    ] as [string, boolean]),
  ]

  const [dealBatches, macroBatches] = await Promise.all([
    Promise.all(dealFeeds.map(([url, req]) => fetchFeed(url, req))),
    Promise.all(macroFeeds.map(([url, req]) => fetchFeed(url, req))),
  ])

  function dedup(batches: RawItem[][]): RawItem[] {
    const seen = new Set<string>()
    const items: RawItem[] = []
    for (const batch of batches) {
      for (const item of batch) {
        if (!seen.has(item.url)) { seen.add(item.url); items.push(item) }
      }
    }
    return items.sort((a, b) => b.pub.getTime() - a.pub.getTime())
  }

  return {
    deal:  dedup(dealBatches).slice(0, 60),
    macro: dedup(macroBatches).slice(0, 30),
  }
}

// ── Recurring story tracking ───────────────────────────────────────────────────

async function getPreviousSeenUrls(): Promise<Set<string>> {
  try {
    const rows: { seen_urls: string[] }[] = await sbGet(
      'daily_briefs?select=seen_urls&order=date.desc&limit=3'
    )
    const seen = new Set<string>()
    for (const row of rows) {
      for (const url of (row.seen_urls ?? [])) {
        seen.add(url)
      }
    }
    return seen
  } catch {
    return new Set()
  }
}

// ── Gemini brief generation ────────────────────────────────────────────────────

const BRIEF_SYSTEM_PROMPT = `You are a senior capital markets analyst writing a daily market intelligence brief for sophisticated investors and operators. Synthesise what happened today across capital flows and ownership change, surface what matters beneath the surface, and tell readers what to think about — not what to think.

The brief must have exactly these sections in this order:

**Executive Summary**
4 to 6 sentences answering: what stood out today, where activity is forming rather than closing, what feels structurally important, and what this implies about risk appetite or capital dynamics. Lead with the sharpest observation.

**Confirmed Transactions**
Only announced or clearly progressing deals. For each deal, write three distinct blocks in this order:

Deal narrative — 4 to 6 sentences. Name both parties. Describe what the target company actually does: its product, customers, revenue model, and market position. State the deal structure (acquisition, minority stake, merger, carve-out, etc.), the size if disclosed, and any notable terms such as earnouts, regulatory conditions, or financing arrangements. Include sector context only if it explains why this asset was attractive to this buyer at this moment. This is the primary account of what happened — do not compress it into a headline restatement.

Why it matters — 2 to 3 sentences. Say something not obvious from the headline. Explain the strategic logic from the buyer's perspective, what the seller achieved, or what the deal reveals about competitive dynamics in this sector. Do not restate the deal narrative.

So what — 2 to 3 sentences. Draw out what this deal reveals about the broader capital environment, sector ownership patterns, or buyer appetite. Illuminate an implication the reader might not have drawn themselves. Do not prescribe action.

Include the deal URL on its own line immediately after the deal narrative block, unmodified.

**Situations to Watch**
Signals, not certainty. Strategic reviews, companies exploring options, activist pressure, balance sheet stress, refinancing risk, regulatory overhangs. For each: why this could evolve into a transaction or control shift, and what specific developments would confirm or weaken the thesis.
Include the URL on its own line after each item.

**Macro Pulse**
Gold, oil, rates, inflation, currencies — the variables that reprice every deal model. Cover what actually moved today: the number, the direction, and why it matters to someone allocating capital. If rates moved, say by how much and what it implies for leveraged buyout financing costs. If oil spiked, say which basket, by what percentage, and which sectors feel it first. If inflation data printed, compare to expectations. Be precise. No vague signals — only things that changed the calculus. Include the URL on its own line after each item.

**Regulatory and Market Intelligence**
Developments shaping the transaction environment even when no deal is imminent. Regulation, antitrust, policy, fundraising signals, financing conditions. For each: what happened stated plainly, and how it changes the math on transactions or ownership.
Include the URL on its own line after each item.

**Sector Heatmap**
Qualitative and directional, not quantitative. Four categories: Building momentum, Steady activity, Pressure or transition, Quiet or noise only. Each sector gets one clean standalone sentence. Sector names bolded at the start of the sentence, nothing else bolded. No bullets or lists anywhere in this section.

**Closing Take**
2 to 3 sentences synthesising the dominant themes across today's activity into one directional paragraph. No new ideas. Write what today's pattern reveals about where capital is moving and why. Like a trader's morning note: direct, forward-looking, no filler.

WRITING RULES:
- Model your voice on the Lex column in the FT: short sentences, strong nouns, no adjective stacking. Say the thing once. If a qualifier is needed to make a sentence true, cut the qualifier and rewrite the sentence.
- Every paragraph leads with the fact or the point — not a scene-setter. Never open a paragraph with "Today's market activity," "The data confirms," "Against a backdrop of," or any sentence that exists only to announce what you are about to say.
- No compound adjective pileups. "Robust, bifurcated capital environment" is four words for nothing. Write "Deal volume is up; returns are not" instead.
- No pointing back. Never end a sentence with: "This underscores," "This highlights," "This signals," "This suggests," "This indicates," "This reflects," "contributing to," "showcasing," "demonstrating." If it is worth saying, say it directly as its own sentence.
- No present participle tacking. Do not add an "-ing" clause to the end of a sentence to simulate depth. "...highlighting the trend toward consolidation" and "...reflecting broader caution" are padding. Write the observation as its own sentence or cut it.
- Use "is" and "are." Do not substitute "serves as," "stands as," "marks," "represents," or "functions as" for a direct copula. "Ares is the buyer" not "Ares serves as the acquiring party."
- No rule of three. Do not force ideas into groups of three to sound comprehensive. Two real points beat three padded ones.
- No vague attribution. Do not write "observers note," "experts argue," "analysts believe," or "industry sources suggest" without naming who specifically.
- No negative parallelism. Do not write "It is not just X; it is Y." Write Y.
- Vary sentence length deliberately. Short sentences carry weight. A longer one can carry context. Never write three sentences of the same structure back to back.
- Banned words and phrases: "robust," "bifurcated," "nuanced," "landscape," "ecosystem," "paradigm," "trajectory," "increasingly," "potentially," "differentiated," "sophisticated," "actionable," "strategic shift," "capital deployment," "alpha generation," "value creation," "structural demand," "it remains to be seen," "amidst broader," "underlying economic," "vibrant," "pivotal," "crucial," "delve," "tapestry," "interplay," "showcase," "foster," "garner," "testament," "enduring," "groundbreaking," "bespoke," "unlock," "transformative."
- Numbers anchor prose. If you know the deal size, the fund target, the revenue multiple — use it. Specifics replace adjectives.
- No separator lines, dashes, bullets, asterisks, or list symbols anywhere in the output except where specified. Section headers only may be bolded. Sentence case for all sub-headings. One idea per paragraph. Clean spacing.
- Every deal item that has a URL must include that full URL in the output, on its own line, unmodified. Do not shorten, rewrite, or replace URLs with homepage links. Never drop a URL for formatting reasons.
- ONGOING items: only include if there is genuinely new information — a new stakeholder, a regulatory decision, a financing change, a timeline update. If nothing new, mention it once in the Executive Summary as ongoing and skip the full section treatment. When included, open with: "UPDATE: [what changed since last report]."

Return only the brief. No preamble, no closing remarks.`

function formatItems(items: RawItem[], previousSeen: Set<string>, offset = 0): { text: string; fresh: RawItem[] } {
  const fresh = items.filter(item => !previousSeen.has(item.url))
  const text = fresh.map((item, i) => [
    `[${offset + i + 1}]`,
    `Title: ${item.title}`,
    `Source: ${item.source}`,
    `Date: ${item.pub.toISOString().split('T')[0]}`,
    `URL: ${item.url}`,
  ].join('\n')).join('\n\n')
  return { text, fresh }
}

async function generateBrief(items: { deal: RawItem[]; macro: RawItem[] }, previousSeen: Set<string>): Promise<string> {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const { text: dealText, fresh: freshDeal } = formatItems(items.deal, previousSeen, 0)
  const { text: macroText, fresh: freshMacro } = formatItems(items.macro, previousSeen, freshDeal.length)

  const prompt = `${BRIEF_SYSTEM_PROMPT}

Today's date: ${today}

DEAL & TRANSACTION NEWS:

${dealText}

MACRO-ECONOMIC NEWS (gold, oil, rates, inflation, currencies):

${macroText}`

  const result = await gemini.generateContent(prompt)
  return result.response.text().trim()
}

// ── Handler ────────────────────────────────────────────────────────────────────

async function run() {
  const [items, previousSeen] = await Promise.all([
    fetchAllItems(),
    getPreviousSeenUrls(),
  ])

  if (items.deal.length === 0 && items.macro.length === 0) {
    return NextResponse.json({ error: 'No news items found' }, { status: 422 })
  }

  const content = await generateBrief(items, previousSeen)
  const seenUrls = [...items.deal, ...items.macro].map(i => i.url)
  const today = new Date().toISOString().split('T')[0]

  await sbUpsert('daily_briefs', {
    date: today,
    content,
    generated_at: new Date().toISOString(),
    seen_urls: seenUrls,
  })

  return NextResponse.json({ date: today, content })
}

export async function GET() {
  return run()
}

export async function POST() {
  return run()
}
