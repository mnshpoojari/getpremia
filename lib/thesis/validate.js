// Pure helpers for validating and post-processing the written thesis.
// Kept as plain JS so the node test runner can import it directly.
import { isOldEntry } from './evidenceParse.js'

export const SECTION_HEADINGS = [
  'Sector Overview',
  'Market Brief',
  'Insight Extraction',
  'Contrarian Lens',
  'Change Detection',
  'What our sources show',
  'Who Should Care',
]
const SOURCES_HEADING = 'What our sources show'
const NO_OLD_SECTIONS = new Set(['sector overview', 'insight extraction', 'change detection'])

const CITE_RE = /\[(E\d+(?:\s*,\s*E\d+)*)\]/g
const STAGE_TREND_RE = /\b(emerging|consensus|trend|trends|trending|outpacing|consolidation|consolidating|momentum|crowded|exhausted|cooling|exploratory|frozen|disinterest|accelerating|decelerating)\b/i
const LIMITED_OVERCLAIM_RE = /\b(emerging|consensus|crowded|exhausted|consolidation|consolidating|strong momentum|clear trend|accelerat\w*|decelerating|frozen|disinterest)\b/i
const THIN_BANNED_RE = /\b(emerging theme|early capital positioning|durable|institutional-led growth|suggests momentum)\b/i
const STAGE_LABEL_RE = /\b(?:stage is|classified as|market is|thesis is in)\s+(?:directional|exploratory|emerging|consensus|crowded|exhausted)\b|\b(?:emerging|exploratory|consensus|crowded|exhausted)\s+(?:stage|theme)\b/i
const AMBIGUOUS_BUYER_RE = /\b(?:private companies|private firms|private buyers)\s+(?:are|were)?\s*(?:never|not|aren't|are not)\s+buyers?\b|\bno private buyers\b/i
const NEGATED_STAGE_TREND_RE = /\b(?:no|not enough to|cannot|can't|does not|doesn't|unable to|too few to|insufficient to)\b[^.!?]{0,45}\b(?:emerging|consensus|trend|trends|trending|outpacing|consolidation|consolidating|momentum|crowded|exhausted|cooling|exploratory|frozen|disinterest|accelerating|decelerating|stage)\b|\b(?:trend|momentum|consensus|stage)\b[^.!?]{0,35}\b(?:is not|cannot be|can't be|does not|isn't)\b/i
const MONTH_RE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/
const ORG_SUFFIX_RE = /\b[A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*)*\s+(?:Ltd|Limited|Inc|LLC|Group|Capital|Partners|Bank|Fund|Holdings|Authority|Ministry|Commission|Council|Corp|Corporation|Ventures|Investments)\b/
const MULTI_CAP_RE = /(?<=[a-z,;:]\s)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/
const ACRONYM_RE = /\b[A-Z]{3,}\b/g
const ACRONYM_STOP = new Set(['EBITDA', 'CAGR', 'USD', 'EUR', 'GBP', 'AED', 'INR', 'GDP', 'M&A', 'SAAS', 'B2B', 'B2C', 'AUM', 'THE', 'AND', 'NOT'])
const THIN_PREFIX = /^Tracked data remains thin here, so this section only records what the sources actually show and what would need to change to justify a stronger call\.\s*/

export function citedIds(text) {
  const ids = []
  for (const m of String(text).matchAll(CITE_RE)) {
    for (const id of m[1].split(',')) ids.push(id.trim())
  }
  return ids
}

function isLimitedTier(tier) {
  return String(tier || '').toLowerCase() === 'insufficient'
}

export function stripCitations(text) {
  return String(text).replace(CITE_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
}

// Splits a line into sentences, keeping any [E#] markers that follow the full stop with their sentence.
export function splitSentences(line) {
  const raw = String(line).split(/(?<=[.!?](?:\[E\d+(?:\s*,\s*E\d+)*\])*)\s+(?=\S)/)
  const merged = []
  for (const piece of raw) {
    const prev = merged[merged.length - 1]
    if (prev && /(?:\b[A-Z]|\b(?:Inc|Ltd|Corp|Co|vs|No|St|Dr|Mr|Ms))\.$/.test(prev)) {
      merged[merged.length - 1] = `${prev} ${piece}`
    } else {
      merged.push(piece)
    }
  }
  return merged.map(s => s.trim()).filter(Boolean)
}

export function parseSections(text) {
  const lines = String(text).split('\n')
  const sections = []
  let current = { heading: null, lines: [] }
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      sections.push(current)
      current = { heading: m[1], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)
  return sections
}

function sameHeading(a, b) {
  return String(a || '').trim().toLowerCase() === b.toLowerCase()
}

export function missingHeadings(text) {
  const found = parseSections(text).map(s => s.heading)
  return SECTION_HEADINGS.filter(h => !found.some(f => sameHeading(f, h)))
}

function splitLine(line) {
  const bullet = line.match(/^(\s*[*-]\s+)/)?.[1] ?? ''
  let rest = line.slice(bullet.length)
  const label = rest.match(/^\*\*[^*]+\*\*\s*/)?.[0] ?? ''
  rest = rest.slice(label.length)
  return { bullet, label, rest }
}

function looksLikeNamedOrg(sentence) {
  if (ORG_SUFFIX_RE.test(sentence) || MULTI_CAP_RE.test(sentence)) return true
  for (const m of sentence.matchAll(ACRONYM_RE)) {
    if (!ACRONYM_STOP.has(m[0])) return true
  }
  return false
}

function needsCitation(sentence) {
  const plain = stripCitations(sentence).replace(/\*\*/g, '')
  if (plain.split(/\s+/).length < 4) return false
  return /\d/.test(plain) || /%/.test(plain) || MONTH_RE.test(plain) || looksLikeNamedOrg(plain)
}

// Returns every violation found, plus the text with hard-violation sentences removed.
// Hard: a citation id that is not in the evidence list; stage/trend language when insufficient, or strong stage claims when limited.
// Soft: a number, date or named organisation without a citation (logged, never removed).
export function analyseThesis(text, { entryIds, signalTier, entries = [], count90d = null }) {
  const known = new Set(entryIds)
  const oldIds = new Set(entries.filter(e => isOldEntry(e)).map(e => e.id))
  const olderThanYearIds = new Set(entries.filter(e => {
    const date = Date.parse(e?.date ?? '')
    return Number.isFinite(date) && Date.now() - date > 365 * 24 * 60 * 60 * 1000
  }).map(e => e.id))
  const insufficient = isLimitedTier(signalTier)
  const limited = String(signalTier || '').toLowerCase() === 'limited'
  const violations = []
  const outSections = []

  for (const section of parseSections(text)) {
    const inSources = sameHeading(section.heading, SOURCES_HEADING)
    const outLines = []
    for (const line of section.lines) {
      if (!line.trim()) { outLines.push(line); continue }
      if (/^###\s/.test(line.trim())) { outLines.push(line); continue }
      const { bullet, label, rest } = splitLine(line)
      const kept = []
      for (const sentence of splitSentences(rest)) {
        let drop = false
        for (const id of citedIds(sentence)) {
          if (!known.has(id)) {
            violations.push({ type: 'unknown_citation', hard: true, section: section.heading, sentence, id })
            drop = true
          }
        }
        const plain = stripCitations(sentence)
        if ((insufficient && STAGE_TREND_RE.test(plain) && !NEGATED_STAGE_TREND_RE.test(plain)) || (limited && LIMITED_OVERCLAIM_RE.test(plain) && !NEGATED_STAGE_TREND_RE.test(plain))) {
          violations.push({ type: 'stage_trend', hard: true, section: section.heading, sentence })
          drop = true
        }
        if (insufficient && THIN_BANNED_RE.test(plain)) {
          violations.push({ type: 'thin_data_phrase', hard: true, section: section.heading, sentence })
          drop = true
        }
        if (insufficient && STAGE_LABEL_RE.test(plain)) {
          violations.push({ type: 'classification_text_mismatch', hard: true, section: section.heading, sentence })
          drop = true
        }
        if (AMBIGUOUS_BUYER_RE.test(plain) && !/defence products?|product customers?|M&A acquirers?|company acquirers?|investors?/i.test(plain)) {
          violations.push({ type: 'ambiguous_buyer_claim', hard: true, section: section.heading, sentence })
          drop = true
        }
        if (!inSources && citedIds(sentence).some(id => olderThanYearIds.has(id)) && !/\bEarlier context\b/i.test(plain)) {
          violations.push({ type: 'older_than_12_months_as_current', hard: true, section: section.heading, sentence })
          drop = true
        }
        // Hard: an entry older than 24 months cannot support these sections at all.
        if (!inSources && NO_OLD_SECTIONS.has(String(section.heading || '').toLowerCase()) && citedIds(sentence).some(id => oldIds.has(id))) {
          violations.push({ type: 'old_entry_in_current_section', hard: true, section: section.heading, sentence })
          drop = true
        }
        if (!drop && !inSources && citedIds(sentence).length === 0 && needsCitation(sentence)) {
          violations.push({ type: 'uncited_fact', hard: false, section: section.heading, sentence })
        }
        // Soft: an entry older than 24 months cited without naming its year in the sentence.
        if (!drop && !inSources && !/\b(?:19|20)\d{2}\b/.test(plain) && citedIds(sentence).some(id => oldIds.has(id))) {
          violations.push({ type: 'old_entry_no_year', hard: false, section: section.heading, sentence })
        }
        if (!drop) kept.push(sentence)
      }
      if (kept.length === 0) continue
      outLines.push(`${bullet}${label}${kept.join(' ')}`)
    }
    const body = outLines.join('\n')
    outSections.push(section.heading ? `## ${section.heading}\n${body}` : body)
  }

  const benchmarkSentences = String(text).split(/(?<=[.!?])\s+/).filter(sentence =>
    /\b(?:CAGR|market size|EV\s*\/\s*EBITDA|P\s*\/\s*E)\b/i.test(sentence) && /\d/.test(sentence)
  )
  const metricValues = new Map()
  for (const sentence of benchmarkSentences) {
    const match = sentence.match(/\b(CAGR|market size|EV\s*\/\s*EBITDA|P\s*\/\s*E)\b/i)
    if (!match) continue
    const metric = match[1].toLowerCase().replace(/\s+/g, '')
    const value = sentence.slice((match.index ?? 0) + match[0].length).match(/\d+(?:\.\d+)?\s*%?/)?.[0] ?? ''
    metricValues.set(metric, [...(metricValues.get(metric) ?? []), { value, sentence }])
    const hasScope = /\b(?:India|Global|United States|United Kingdom|UAE|Europe|Asia|Japan|Australia|Germany|France|Singapore)\b/i.test(sentence)
    const hasPeriod = /\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2})?\b|\b(?:FY\s*\d{2,4}|last\s+(?:30|90|365|12)\s+days?|past\s+12\s+months?)\b/i.test(sentence)
    if (!hasScope || !hasPeriod) {
      violations.push({ type: 'missing_metric_scope_period', hard: true, section: 'Market Brief', sentence })
    }
  }
  for (const [metric, mentions] of metricValues) {
    if (new Set(mentions.map(item => item.value)).size > 1 && mentions.some(item => {
      const sentence = item.sentence
      return !/\b(?:India|Global|United States|United Kingdom|UAE|Europe|Asia|Japan|Australia|Germany|France|Singapore)\b/i.test(sentence) ||
        !/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2})?\b/i.test(sentence)
    })) {
      violations.push({ type: 'duplicate_metric_scope_conflict', hard: true, section: 'Market Brief', metric, sentence: mentions.map(item => item.sentence).join(' | ') })
    }
  }

  return { violations, cleaned: outSections.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

// A section has real content when it keeps at least one sentence of four or more words
// beyond the boilerplate the signal guard adds.
export function countSectionsWithContent(text) {
  const byHeading = new Map()
  for (const s of parseSections(text)) if (s.heading) byHeading.set(s.heading.toLowerCase(), s.lines.join('\n'))
  const detail = SECTION_HEADINGS.map(heading => {
    const body = (byHeading.get(heading.toLowerCase()) ?? '')
      .trim()
      .replace(THIN_PREFIX, '')
      .replace(/\*\*[^*]+\*\*/g, '')
      .replace(/^\s*[*-]\s+/gm, '')
    const words = stripCitations(body).split(/\s+/).filter(Boolean)
    return { heading, hasContent: words.length >= 4 }
  })
  return { count: detail.filter(d => d.hasContent).length, detail }
}

// Replaces [E3]-style ids with numbered markers [1], [2]... in order of first use,
// and returns the matching source list. Ids that are not in the evidence are dropped.
export function citationsToSources(text, entries) {
  const byId = new Map(entries.map(e => [e.id, e]))
  const numberOf = new Map()
  const order = []
  const converted = String(text).replace(CITE_RE, (_m, group) =>
    group.split(',').map(s => s.trim()).map(id => {
      if (!byId.has(id)) return ''
      if (!numberOf.has(id)) { numberOf.set(id, order.length + 1); order.push(id) }
      return `[${numberOf.get(id)}]`
    }).join(''),
  ).replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1')

  const sources = order.map((id, i) => {
    const e = byId.get(id)
    return { n: i + 1, id, type: e.type, source: e.source ?? null, url: e.url ?? null, date: e.date ?? null, text: e.text }
  })
  return { text: converted, sources }
}

/**
 * @param {{ count30d: number, count90d: number, count365d?: number, mediaCount90d: number, sourceCount: number,
 *   items?: Array<{ title?: string, url?: string, published_date?: string, source?: string }>, quota?: boolean, benchmarks?: any }} p
 */
export function buildFactsOnly({ count30d, count90d, count365d, mediaCount90d, sourceCount, items = [], quota = false, benchmarks = null }) {
  const tracked = items.filter(i => i && i.title).slice(0, 5)
  const parts = [
    `Tracked sources show ${count90d} deal record${count90d === 1 ? '' : 's'} in the last 90 days (${count30d} in the last 30 days) and ${count365d ?? count90d} over twelve months, from ${sourceCount} distinct source${sourceCount === 1 ? '' : 's'}, plus ${mediaCount90d} media mention${mediaCount90d === 1 ? '' : 's'} in the last 90 days.`,
    quota
      ? 'A full written read could not be produced for this thesis because the writing service was at capacity; please try again shortly.'
      : 'A full written read could not be produced for this thesis.',
  ]
  const sources = tracked.map((item, i) => ({
    n: i + 1,
    id: `H${i + 1}`,
    type: 'headline_only',
    source: item.source ?? null,
    url: item.url ?? null,
    date: item.published_date ?? null,
    text: item.title ?? '',
  }))
  const benchmarkFields = [
    { key: 'market_size', label: 'Market size', period: benchmarks?.market_size?.year },
    { key: 'cagr', label: 'CAGR', period: benchmarks?.cagr?.period },
    { key: 'ev_ebitda', label: 'EV/EBITDA', period: benchmarks?.ev_ebitda?.context },
  ]
  const benchmarkLines = []
  for (const field of benchmarkFields) {
    const metric = benchmarks?.[field.key]
    if (metric?.value == null || !metric?.source_url || !metric?.geography_scope || !field.period) continue
    const n = sources.length + 1
    const scope = metric.geography_scope || 'scope unavailable'
    const period = field.period || 'period unavailable'
    const value = field.key === 'market_size'
      ? `$${Number(metric.value) >= 1000 ? `${(Number(metric.value) / 1000).toFixed(1)}T` : `${Number(metric.value).toFixed(1)}bn`}`
      : field.key === 'ev_ebitda' ? `${Number(metric.value).toFixed(1)}x` : `${Number(metric.value).toFixed(1)}%`
    benchmarkLines.push(`${field.label}: ${value} (${scope}, ${period}) [${n}].`)
    sources.push({ n, id: `B${n}`, type: 'benchmark', source: metric.source_name ?? null, url: metric.source_url, date: period, text: `${field.label} ${value}` })
  }
  if (benchmarkLines.length) parts.push(`Benchmarks: ${benchmarkLines.join(' ')}`)
  let body = parts.join(' ')
  if (tracked.length === 1) {
    body += `\n\nMost recent tracked headline: ${tracked[0].title} [1].`
  } else if (tracked.length > 1) {
    body += `\n\nMost recent tracked headlines:\n\n${tracked.map((t, i) => `* ${t.title} [${i + 1}]`).join('\n')}`
  }
  return { text: `## What our sources show\n\n${body}`, sources }
}

export function buildCriticPrompt(text, entries) {
  const list = entries.map(e => `[${e.id}] ${e.type === 'headline_only' ? '(HEADLINE ONLY) ' : ''}${e.text}`).join('\n')
  return `You are a hard-nosed editor checking a sector briefing against its evidence list. Review EVERY paragraph of the briefing with this rubric:
1. Is each claim supported by the evidence entries it cites? (A HEADLINE ONLY entry supports only what the headline literally says.)
2. Could this sentence be written about any sector? If so it is generic.
3. Does it say something falsifiable?
4. Is anything repeated from elsewhere in the briefing?
5. Does it make a stage or trend claim that the tracked counts cannot support?

Return JSON only, in this shape: {"issues":[{"line":"the exact sentence copied from the briefing","problem":"unsupported|generic|not_falsifiable|repeated|stage_claim","fix":"one short instruction"}]}
Return {"issues":[]} if nothing needs fixing. Report at most 8 issues, worst first. Never invent facts in "fix".

EVIDENCE
${list}

BRIEFING
${text}`
}

export function parseCriticJson(raw) {
  try {
    const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned)
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : []
    return issues
      .filter(i => i && typeof i.line === 'string' && i.line.trim())
      .slice(0, 8)
      .map(i => ({
        line: String(i.line).slice(0, 400),
        problem: typeof i.problem === 'string' ? i.problem.slice(0, 40) : 'unsupported',
        fix: typeof i.fix === 'string' ? i.fix.slice(0, 300) : '',
      }))
  } catch {
    return []
  }
}

export function describeProblems({ violations = [], criticIssues = [], missing = [] }) {
  const lines = []
  for (const h of missing) lines.push(`Missing the required heading "## ${h}". Add it (one honest sentence is fine if the evidence is thin).`)
  for (const v of violations) {
    if (v.type === 'unknown_citation') lines.push(`Cites ${v.id}, which is not in the evidence list: "${v.sentence}". Cite an existing id or remove the claim.`)
    else if (v.type === 'stage_trend') lines.push(`Uses stage or trend language that the tracked counts cannot support: "${v.sentence}". Rewrite it as a plain statement of what the sources show.`)
    else if (v.type === 'thin_data_phrase') lines.push(`Uses a prohibited thin-data phrase: "${v.sentence}". Replace it with an observed fact and state the limit.`)
    else if (v.type === 'classification_text_mismatch') lines.push(`The classification is Insufficient Data, but this sentence assigns a market stage: "${v.sentence}". Align the wording with the classification.`)
    else if (v.type === 'older_than_12_months_as_current') lines.push(`Uses evidence older than 12 months as current: "${v.sentence}". Label it "Earlier context" or remove it.`)
    else if (v.type === 'ambiguous_buyer_claim') lines.push(`Ambiguous buyer wording: "${v.sentence}". Say whether it means customers who buy defence products or M&A acquirers/investors.`)
    else if (v.type === 'missing_metric_scope_period') lines.push(`This benchmark figure lacks geography scope or period: "${v.sentence}". State both explicitly.`)
    else if (v.type === 'duplicate_metric_scope_conflict') lines.push(`The same metric has multiple values without clear scope and period labels: "${v.sentence}". Label each value or explain the difference.`)
    else if (v.type === 'old_entry_in_current_section') lines.push(`Cites an entry older than 24 months in a section about current activity: "${v.sentence}". Remove the claim.`)
    else if (v.type === 'old_entry_no_year') lines.push(`Uses an entry older than 24 months without naming its year: "${v.sentence}". Name the year, or remove the claim.`)
    else lines.push(`Contains a number, date or named organisation without a citation: "${v.sentence}". Add the [E#] id, or remove it if no entry supports it.`)
  }
  for (const c of criticIssues) lines.push(`Editor (${c.problem}): "${c.line}"${c.fix ? ` ${c.fix}` : ''}`)
  return lines.slice(0, 20)
}
