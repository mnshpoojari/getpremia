import { applySignalSectionGuard } from './guard.js'
import { normaliseThesisMarkdown } from './format.js'
import { isOldEntry } from './evidenceParse.js'
import {
  analyseThesis,
  buildCriticPrompt,
  buildFactsOnly,
  citationsToSources,
  countSectionsWithContent,
  describeProblems,
  missingHeadings,
  parseCriticJson,
} from './validate.js'

const CRITIC_BY_MS = 32_000
const RETRY_BY_MS = 40_000
const HARD_STOP_MS = 56_000
const WRITER_TIMEOUT_MS = 30_000
const MIN_SECTIONS_WITH_CONTENT = 4
// Mirrors WRITER_MAX_OUTPUT_TOKENS in config.ts (this file is plain JS so tests can import it directly).
const WRITER_MAX_OUTPUT_TOKENS = 3500

function formatEvidence(entries) {
  return entries
    .map(e => {
      const tag = e.type === 'headline_only' ? '(HEADLINE ONLY) ' : ''
      const old = isOldEntry(e) ? `(OLDER THAN 24 MONTHS: ${String(e.date).slice(0, 4)}) ` : ''
      const src = [e.source, e.date].filter(Boolean).join(', ')
      return `[${e.id}] ${tag}${old}${e.text}${src ? ` — ${src}` : ''}`
    })
    .join('\n')
}

export function buildWriterPrompt(params, entries, asOfDate) {
  const sector = params.sector || 'unspecified sector'
  const geography = params.geography || 'unspecified geography'
  const limited = ['insufficient', 'limited'].includes(String(params.signalTier).toLowerCase())
  return `You are Premia's sector analyst. Write a briefing on this thesis the way a deal professional would talk in a committee room: plain, specific, direct.

THE RULE
You may only state facts that appear in the EVIDENCE list below. Cite the entry after each factual claim with its id, like [E3], placed before the full stop. A fact that is not in the evidence is simply not stated. Do not add background knowledge, and do not hedge with "(unverified)".
Entries marked (HEADLINE ONLY) support only what the headline literally says. Do not add a buyer type, price, rationale or implication for them.
Every deal, figure, regulator, date or organisation you name must be in the evidence. Benchmarks keep the geography scope they were given; never present a global figure as local.
If the evidence is thin for a section, write one honest sentence saying what the evidence does and does not show. The heading must still be there.
RECENCY: entries marked (OLDER THAN 24 MONTHS) may only be used as historical background. Name their year in the sentence that uses them (for example "In 2018, ..."). Never use them for "Surprising Observation", "What Most People Miss", "Change Detection" or any claim about current activity. Entries with no date should not be presented as current either.

Absence of tracked deals is a coverage limitation, not evidence of low activity. Never infer disinterest, a frozen market or a finished cycle from sparse data.
${limited ? `The signal tier is "${params.signalTier}": make no claim about market stage, trend, momentum, consensus, consolidation or velocity anywhere in the briefing.` : `The signal tier is "${params.signalTier}": stage or trend claims are allowed only where the tracked counts below support them.`}

VOICE: two examples of the standard wanted (the names and numbers are made up; never reuse them):
Example 1: "Northgate Capital bought a 60% stake in Alder Pay for $48 million [E2]. The announcement says the aim was to add card issuing to an existing payments licence [E2]. Nothing in the coverage gives the multiple, so we do not quote one."
Example 2: "Two of the three tracked deals closed in the same quarter, both with strategic buyers [E4][E5]. That is a small sample, so it tells us who is active, not how crowded the market is."

REQUIRED OUTPUT: these exact markdown headings, in this order, each followed by its paragraphs. Use "* " for bullet lists.
## Sector Overview
Say what this sector is in plain terms, who the typical buyers and sellers are, and how deals are usually structured (stakes, platforms, roll-ups, carve-outs), using the sector-structure and acquirer evidence. Regulation must NOT be the main content here; it belongs in "The Macro Context". If the evidence does not support what the sector is or who buys and sells, write one honest sentence instead of padding.
## Market Brief
**The Reality:** what the tracked counts and cited deals show.
**The Macro Context:** regulation and licensing rules, capital sources, drivers and constraints that the evidence supports.
**The Execution Angle:** one practical implication for an advisor or investor.
## Insight Extraction
**Surprising Observation:** one specific, falsifiable claim.
**Why This Matters:** the mechanism and the consequence.
**What Most People Miss:** one testable overlooked factor.
## Contrarian Lens
**Alternative Interpretation:** a plausible different reading of the same evidence.
**What Data Would Change The View:** exactly three concrete, observable bullets.
## Change Detection
Exactly three bullets, each with a direction and a named driver that the evidence supports.
## What our sources show
Only the tracked counts, dates and sources below, and whether the set is thin. Plain language such as "tracked sources show limited deal activity"; no stage label. No citations needed in this section.
## Who Should Care
One actionable sentence each for Investors, Founders, Corporates and Advisors.

Return only the briefing. Do not add an introduction.

SEARCH CONTEXT
Thesis: ${params.userInput}
Sector: ${sector}
Geography: ${geography}
As of: ${asOfDate}
Search expansion: ${params.expansionDescription ?? 'No query expansion was needed.'}
Tracked deals, 90d: ${params.count90d}
Tracked deals, 30d: ${params.count30d}
Deal records retrieved over 12 months: ${params.count365d ?? params.count90d}
Tracked media mentions, 90d: ${params.mediaCount90d}
Distinct sources in this query: ${params.sourceCount}
Signal tier: ${params.signalTier}
Confidence: ${params.confidencePercent}% (${params.activeMonths} active month(s))
Consensus state: ${params.consensusState}

EVIDENCE
${formatEvidence(entries)}`
}

function buildRetryPrompt(basePrompt, draft, problems) {
  return `${basePrompt}

YOUR PREVIOUS DRAFT
${draft}

PROBLEMS FOUND IN THAT DRAFT
${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Rewrite the whole briefing, in the same format, fixing every problem. Keep what was already good. Do not add any fact that is not in the evidence list.`
}

// Runs write -> validate + critic -> at most one revision -> cleanup.
// `call` and `isQuota` are injected so the flow can be tested without a model.
export async function runThesisPipeline({ params, entries, writerModel, criticModel, call, isQuota, now = Date.now, startedAt = now(), criticEnabled = true, deadlineMs = HARD_STOP_MS }) {
  const asOfDate = new Date().toISOString().slice(0, 10)
  const meta = {
    model_calls: 0,
    retry_ran: false,
    fallback: false,
    fallback_reason: null,
    quota_error: false,
    evidence_available: entries.length,
    evidence_cited: 0,
    evidence_headline_only: entries.filter(e => e.type === 'headline_only').length,
    hard_violations: 0,
    soft_violations: 0,
    critic_issues: 0,
    sections_with_content: 0,
    writer_ms: 0,
    writer_output_tokens: null,
    writer_ms_per_100_tokens: null,
    validator_ms: 0,
    guard_ms: 0,
    convert_ms: 0,
  }
  const elapsed = () => now() - startedAt
  const noteError = err => { if (isQuota(err)) meta.quota_error = true }

  const facts = reason => {
    meta.fallback = true
    meta.fallback_reason = reason
    const f = buildFactsOnly({
      count30d: params.count30d,
      count90d: params.count90d,
      count365d: params.count365d,
      mediaCount90d: params.mediaCount90d,
      sourceCount: params.sourceCount,
      items: params.synthesisItems,
      quota: meta.quota_error,
    })
    return { thesis: f.text, thesis_sources: f.sources, meta }
  }

  if (entries.length === 0) return facts('no_evidence')

  const basePrompt = buildWriterPrompt(params, entries, asOfDate)
  const entryIds = entries.map(e => e.id)
  const check = text => {
    const analysis = analyseThesis(text, { entryIds, signalTier: params.signalTier, entries })
    const missing = missingHeadings(text).filter(h => h !== 'What our sources show')
    return { ...analysis, missing }
  }

  const writerBudget = Math.min(WRITER_TIMEOUT_MS, deadlineMs - elapsed())
  if (writerBudget <= 0) return facts('deadline')
  let draft1
  const writerStart = now()
  try {
    meta.model_calls++
    const usage = {}
    draft1 = normaliseThesisMarkdown((await call(writerModel, basePrompt, { timeoutMs: writerBudget, label: 'writer', maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS, usage })).trim())
    if (usage.outputTokens) {
      meta.writer_output_tokens = usage.outputTokens
      meta.writer_ms_per_100_tokens = Math.round(((now() - writerStart) / usage.outputTokens) * 100)
    }
  } catch (err) {
    noteError(err)
    meta.writer_ms = now() - writerStart
    return facts(/timed out/i.test(String(err?.message)) ? 'deadline' : 'writer_failed')
  }
  meta.writer_ms = now() - writerStart
  if (!draft1) return facts('writer_empty')

  const validatorStart = now()
  const first = check(draft1)
  meta.validator_ms = now() - validatorStart
  let criticIssues = []
  if (criticEnabled && elapsed() < CRITIC_BY_MS) {
    try {
      meta.model_calls++
      const raw = await call(criticModel, buildCriticPrompt(draft1, entries), { json: true, timeoutMs: 20_000 })
      criticIssues = parseCriticJson(raw)
    } catch (err) {
      noteError(err)
    }
  }
  meta.critic_issues = criticIssues.length

  let finalText = draft1
  let finalCheck = first
  const problems = describeProblems({ violations: first.violations, criticIssues, missing: first.missing })
  if (criticEnabled && problems.length > 0 && elapsed() < RETRY_BY_MS) {
    meta.retry_ran = true
    try {
      meta.model_calls++
      const draft2 = (await call(writerModel, buildRetryPrompt(basePrompt, draft1, problems), {
        timeoutMs: Math.min(WRITER_TIMEOUT_MS, HARD_STOP_MS - elapsed()),
      })).trim()
      if (draft2) {
        const second = check(draft2)
        if (second.missing.length <= first.missing.length) {
          finalText = draft2
          finalCheck = second
        }
      }
    } catch (err) {
      noteError(err)
    }
  }

  meta.hard_violations = finalCheck.violations.filter(v => v.hard).length
  meta.soft_violations = finalCheck.violations.filter(v => !v.hard).length
  const staleFlags = finalCheck.violations.filter(v => v.type === 'old_entry_no_year')
  if (staleFlags.length) console.warn('[thesis] old evidence cited without a year:', JSON.stringify(staleFlags.map(v => v.sentence.slice(0, 160))))
  const guardStart = now()
  const guarded = normaliseThesisMarkdown(applySignalSectionGuard(finalCheck.cleaned, params.signalTier))
  meta.guard_ms = now() - guardStart
  const content = countSectionsWithContent(guarded)
  meta.sections_with_content = content.count
  if (content.count < MIN_SECTIONS_WITH_CONTENT) return facts('hollow')

  const convertStart = now()
  const converted = citationsToSources(guarded, entries)
  meta.convert_ms = now() - convertStart
  meta.evidence_cited = converted.sources.length
  return { thesis: converted.text, thesis_sources: converted.sources, meta }
}
