import test from 'node:test'
import assert from 'node:assert/strict'
import { runThesisPipeline } from '../lib/thesis/orchestrate.js'

const entries = [
  { id: 'E1', type: 'deal_fact', text: 'Northgate bought Alder Pay for $48 million', source: 'Reuters', url: 'https://example.com/1', date: '2025-03-01' },
  { id: 'E2', type: 'research_regulation', text: 'The regulator requires a licence', source: 'Gov', url: null, date: null },
]

const sections = [
  'Sector Overview', 'Market Brief', 'Insight Extraction', 'Contrarian Lens', 'Change Detection', 'What our sources show', 'Who Should Care',
]
const draft = sections.map(s => `## ${s}\n\nThe regulator requires a licence [E2]. Northgate paid $48 million for Alder Pay [E1]. A made up claim [E9].`).join('\n\n')

const params = {
  userInput: 'Payments in the UK', sector: 'Financial Services', geography: 'United Kingdom', consensusState: 'QUIET',
  count30d: 0, count90d: 1, count365d: 2, mediaCount90d: 3, sourceCount: 2, signalTier: 'sufficient',
  confidencePercent: 10, activeMonths: 1, synthesisItems: [], marketContext: null, expansionDescription: null,
}

const isQuota = err => /429|quota/i.test(String(err?.message ?? err))
const run = (call, over = {}) => runThesisPipeline({ params, entries, writerModel: 'w', criticModel: 'c', call, isQuota, ...over })

test('critic disabled: one model call, no retry, hard violations still cleaned', async () => {
  const calls = []
  const call = async (model, prompt, opts) => { calls.push(model); return draft }
  const r = await run(call, { criticEnabled: false })
  assert.deepEqual(calls, ['w'])
  assert.equal(r.meta.model_calls, 1)
  assert.equal(r.meta.retry_ran, false)
  assert.ok(!r.thesis.includes('made up claim'))
  assert.ok(typeof r.meta.writer_ms === 'number')
})

test('writer call receives a timeout no larger than the remaining deadline', async () => {
  let seen
  const call = async (model, prompt, opts) => { seen = opts.timeoutMs; return draft }
  await run(call, { criticEnabled: false, deadlineMs: 9000, now: () => 1000, startedAt: 0 })
  assert.equal(seen, 8000)
})

test('deadline already used up returns facts-only without calling the model', async () => {
  let called = false
  const call = async () => { called = true; return draft }
  const r = await run(call, { criticEnabled: false, deadlineMs: 9000, now: () => 9500, startedAt: 0 })
  assert.equal(called, false)
  assert.equal(r.meta.fallback, true)
  assert.equal(r.meta.fallback_reason, 'deadline')
})

test('a writer timeout is reported as a deadline fallback, not a quota error', async () => {
  const call = async () => { throw new Error('model call timed out after 8000ms') }
  const r = await run(call, { criticEnabled: false })
  assert.equal(r.meta.fallback_reason, 'deadline')
  assert.equal(r.meta.quota_error, false)
})
