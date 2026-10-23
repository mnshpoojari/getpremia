import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyseThesis,
  buildFactsOnly,
  citationsToSources,
  citedIds,
  countSectionsWithContent,
  describeProblems,
  missingHeadings,
  parseCriticJson,
  splitSentences,
} from '../lib/thesis/validate.js'
import { runThesisPipeline } from '../lib/thesis/orchestrate.js'

const entries = [
  { id: 'E1', type: 'deal_fact', text: 'Northgate bought Alder Pay for $48 million', source: 'Reuters', url: 'https://example.com/1', date: '2025-03-01' },
  { id: 'E2', type: 'headline_only', text: 'Alder Pay sold', source: 'FT', url: 'https://example.com/2', date: '2025-03-02' },
  { id: 'E3', type: 'research_regulation', text: 'The regulator requires a licence', source: 'Gov', url: null, date: null },
]

const goodDraft = `## Sector Overview

The regulator requires a licence before any change of control [E3]. Buyers must plan for that step.

## Market Brief

**The Reality:** Northgate paid $48 million for Alder Pay [E1]. Only one tracked deal is on record.

**The Macro Context:** Coverage of financing terms is missing from the retrieved sources.

**The Execution Angle:** Check the licence position before pricing any approach to a target.

## Insight Extraction

**Surprising Observation:** One headline reports a sale of Alder Pay without any terms [E2].

**Why This Matters:** Without terms nobody can benchmark a price for similar firms.

## Contrarian Lens

**Alternative Interpretation:** One deal may simply be the only one that was reported.

## Change Detection

* A second reported deal would change how thin this looks.

## What our sources show

Tracked sources show 1 deal record in 90 days.

## Who Should Care

Investors should read the licence rule first.`

const params = {
  userInput: 'Payments in the UK',
  sector: 'Financial Services',
  geography: 'United Kingdom',
  consensusState: 'QUIET',
  count30d: 0,
  count90d: 1,
  count365d: 2,
  mediaCount90d: 3,
  sourceCount: 2,
  signalTier: 'insufficient',
  confidencePercent: 10,
  activeMonths: 1,
  expansionDescription: null,
  marketContext: null,
  synthesisItems: [{ title: 'Alder Pay sold', url: 'https://example.com/2', published_date: '2025-03-02', source: 'FT' }],
}

const isQuota = err => /429|quota/i.test(String(err?.message ?? err))

test('citedIds reads single and grouped ids', () => {
  assert.deepEqual(citedIds('A [E1]. B [E2, E3]. C [E4][E5].'), ['E1', 'E2', 'E3', 'E4', 'E5'])
})

test('splitSentences keeps citations and abbreviations together', () => {
  const s = splitSentences('Acme Inc. bought U.S. assets [E1]. Another sentence here [E2].')
  assert.equal(s.length, 2)
})

test('unknown citation ids are hard violations and the sentence is removed', () => {
  const text = '## Market Brief\n\nNorthgate paid a lot [E9]. Another sentence stays here [E1].'
  const { violations, cleaned } = analyseThesis(text, { entryIds: ['E1'], signalTier: 'strong' })
  assert.equal(violations.filter(v => v.type === 'unknown_citation' && v.hard).length, 1)
  assert.ok(!cleaned.includes('[E9]'))
  assert.ok(cleaned.includes('[E1]'))
})

test('stage and trend language is a hard violation for insufficient and limited tiers only', () => {
  const text = '## Market Brief\n\nThe sector shows strong momentum [E1]. Buyers are active [E1].'
  for (const tier of ['insufficient', 'limited']) {
    const r = analyseThesis(text, { entryIds: ['E1'], signalTier: tier })
    assert.equal(r.violations.filter(v => v.type === 'stage_trend').length, 1)
    assert.ok(!r.cleaned.includes('momentum'))
  }
  const strong = analyseThesis(text, { entryIds: ['E1'], signalTier: 'strong' })
  assert.equal(strong.violations.filter(v => v.type === 'stage_trend').length, 0)
  assert.ok(strong.cleaned.includes('momentum'))
})

test('uncited numbers are logged but the sentence is kept', () => {
  const text = '## Market Brief\n\nThe deal was worth $50 million last year.'
  const { violations, cleaned } = analyseThesis(text, { entryIds: ['E1'], signalTier: 'strong' })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].hard, false)
  assert.ok(cleaned.includes('$50 million'))
})

test('the sources section is exempt from the uncited-fact check', () => {
  const text = '## What our sources show\n\nTracked sources show 4 deal records in 90 days.'
  const { violations } = analyseThesis(text, { entryIds: [], signalTier: 'strong' })
  assert.equal(violations.length, 0)
})

test('labels survive when a later sentence in the line is removed', () => {
  const text = '## Market Brief\n\n**The Reality:** Fine statement here today [E1]. Bad claim here [E7].'
  const { cleaned } = analyseThesis(text, { entryIds: ['E1'], signalTier: 'strong' })
  assert.ok(cleaned.includes('**The Reality:** Fine statement here today [E1].'))
  assert.ok(!cleaned.includes('E7'))
})

test('missingHeadings lists absent sections', () => {
  assert.deepEqual(missingHeadings(goodDraft), [])
  assert.deepEqual(missingHeadings('## Sector Overview\n\nText here now.'), [
    'Market Brief', 'Insight Extraction', 'Contrarian Lens', 'Change Detection', 'What our sources show', 'Who Should Care',
  ])
})

test('countSectionsWithContent ignores empty sections and guard boilerplate', () => {
  assert.equal(countSectionsWithContent(goodDraft).count, 7)
  const hollow = '## Sector Overview\n\n## Market Brief\n\n## Insight Extraction\n\nOne real honest sentence here.\n\n## What our sources show\n\nTracked data remains thin here, so this section only records what the sources actually show and what would need to change to justify a stronger call.'
  assert.equal(countSectionsWithContent(hollow).count, 1)
})

test('citationsToSources numbers ids by first use and strips raw ids', () => {
  const { text, sources } = citationsToSources('First [E3]. Second [E1, E3]. Gone [E9].', entries)
  assert.equal(text, 'First [1]. Second [2][1]. Gone.')
  assert.deepEqual(sources.map(s => [s.n, s.id]), [[1, 'E3'], [2, 'E1']])
  assert.ok(!/\[E\d+\]/.test(text))
})

test('buildFactsOnly reports counts, headlines and the honest line', () => {
  const f = buildFactsOnly({ count30d: 0, count90d: 1, count365d: 2, mediaCount90d: 3, sourceCount: 2, items: params.synthesisItems })
  assert.ok(f.text.startsWith('## What our sources show'))
  assert.ok(f.text.includes('A full written read could not be produced for this thesis.'))
  assert.ok(f.text.includes('Alder Pay sold [1]'))
  assert.equal(f.sources[0].url, 'https://example.com/2')
  assert.ok(buildFactsOnly({ count30d: 0, count90d: 0, mediaCount90d: 0, sourceCount: 0, quota: true }).text.includes('at capacity'))
})

test('parseCriticJson tolerates fences and bad output', () => {
  assert.equal(parseCriticJson('```json\n{"issues":[{"line":"x y z","problem":"generic","fix":"be specific"}]}\n```').length, 1)
  assert.deepEqual(parseCriticJson('not json'), [])
  assert.deepEqual(parseCriticJson('{"issues":[{"nope":1}]}'), [])
})

test('describeProblems lists each kind of problem', () => {
  const lines = describeProblems({
    violations: [{ type: 'unknown_citation', id: 'E9', sentence: 'S1' }, { type: 'uncited_fact', sentence: 'S2' }, { type: 'stage_trend', sentence: 'S3' }],
    criticIssues: [{ line: 'L', problem: 'generic', fix: 'be specific' }],
    missing: ['Market Brief'],
  })
  assert.equal(lines.length, 5)
})

function makeCall(responses) {
  const calls = []
  const call = async (model, prompt, opts) => {
    calls.push({ model, prompt, opts })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { call, calls }
}

const run = (call, over = {}) => runThesisPipeline({
  params, entries, writerModel: 'writer-x', criticModel: 'critic-y', call, isQuota, ...over,
})

test('clean draft: writer + critic only, no retry, citations converted', async () => {
  const { call, calls } = makeCall([goodDraft, '{"issues":[]}'])
  const r = await run(call)
  assert.equal(r.meta.model_calls, 2)
  assert.equal(r.meta.retry_ran, false)
  assert.equal(r.meta.fallback, false)
  assert.deepEqual(calls.map(c => c.model), ['writer-x', 'critic-y'])
  assert.equal(calls[1].opts.json, true)
  assert.ok(!/\[E\d+\]/.test(r.thesis))
  assert.equal(r.meta.evidence_available, 3)
  assert.equal(r.meta.evidence_cited, 3)
  assert.equal(r.meta.evidence_headline_only, 1)
  assert.equal(r.thesis_sources.length, 3)
})

test('critic issues trigger exactly one retry, never a second loop', async () => {
  const { call, calls } = makeCall([
    goodDraft,
    '{"issues":[{"line":"Buyers must plan for that step.","problem":"generic","fix":"name the step"}]}',
    goodDraft,
    '{"issues":[{"line":"still bad","problem":"generic","fix":"x"}]}',
  ])
  const r = await run(call)
  assert.equal(r.meta.retry_ran, true)
  assert.equal(r.meta.model_calls, 3)
  assert.equal(calls.length, 3)
  assert.ok(calls[2].prompt.includes('PROBLEMS FOUND IN THAT DRAFT'))
  assert.ok(calls[2].prompt.includes('name the step'))
})

test('a draft with an unknown citation is retried and cleaned', async () => {
  const bad = goodDraft.replace('[E1]', '[E9]')
  const { call } = makeCall([bad, '{"issues":[]}', bad])
  const r = await run(call)
  assert.equal(r.meta.retry_ran, true)
  assert.ok(r.meta.hard_violations >= 1)
  assert.ok(!r.thesis.includes('E9'))
  assert.ok(!r.thesis.includes('paid $48 million'))
})

test('critic failure does not stop the pipeline', async () => {
  const { call } = makeCall([goodDraft, new Error('boom')])
  const r = await run(call)
  assert.equal(r.meta.fallback, false)
  assert.equal(r.meta.retry_ran, false)
})

test('writer quota error returns the facts-only read and flags quota', async () => {
  const { call } = makeCall([new Error('429 Too Many Requests: quota exceeded')])
  const r = await run(call)
  assert.equal(r.meta.quota_error, true)
  assert.equal(r.meta.fallback, true)
  assert.equal(r.meta.fallback_reason, 'writer_failed')
  assert.ok(r.thesis.includes('could not be produced'))
})

test('a hollow thesis falls back to facts-only', async () => {
  const hollow = '## Sector Overview\n\n## Market Brief\n\n## Insight Extraction\n\n## Contrarian Lens\n\n## Change Detection\n\n## Who Should Care\n\nShort.'
  const { call } = makeCall([hollow, '{"issues":[]}', hollow])
  const r = await run(call)
  assert.equal(r.meta.fallback, true)
  assert.equal(r.meta.fallback_reason, 'hollow')
  assert.ok(r.thesis.startsWith('## What our sources show'))
})

test('no evidence means no model calls and a facts-only read', async () => {
  const { call, calls } = makeCall([])
  const r = await run(call, { entries: [] })
  assert.equal(calls.length, 0)
  assert.equal(r.meta.fallback_reason, 'no_evidence')
})

test('retry is skipped when too much time has passed', async () => {
  const { call } = makeCall([goodDraft.replace('[E3]', '[E9]'), '{"issues":[]}'])
  let t = 0
  const r = await run(call, { now: () => (t += 45_000), startedAt: 0 })
  assert.equal(r.meta.retry_ran, false)
  assert.equal(r.meta.model_calls, 1)
})
