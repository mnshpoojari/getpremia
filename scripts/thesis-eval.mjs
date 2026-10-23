// Runs a fixed set of theses through the analyse route and saves the results
// to docs/thesis-eval/baseline-<YYYY-MM-DD>.md for before/after comparison.
//
// Usage:  node scripts/thesis-eval.mjs [label]
//   label   optional file prefix (default "baseline")
// Env:    EVAL_BASE_URL  where the app is running (default http://localhost:3000)
//         EVAL_TIMEOUT_MS  per-thesis timeout per request (default 120000)
//         EVAL_PAUSE_MS  pause between theses (default 15000; keeps under the 5/min limit on /api/thesis)

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL_THESES = [
  'Wealth management in Dubai',
  'Healthcare IT roll-ups in the US',
  'Defence manufacturing in India',
  'B2B SaaS in Germany',
  'Femtech in the UK',
  'Fintech in Nigeria',
  'Climate infrastructure in Southeast Asia',
  'Logistics in Saudi Arabia',
  'Agritech in Central Asia',
  'Dog food in China',
]
// EVAL_ONLY="Dubai,India,Germany" runs only the theses containing one of those words.
const only = (process.env.EVAL_ONLY ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const THESES = only.length ? ALL_THESES.filter(t => only.some(o => t.toLowerCase().includes(o))) : ALL_THESES

const BASE_URL = (process.env.EVAL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 120000)
const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS ?? 15000)
const label = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'baseline'
// --critic turns the critic + retry on (dev server only); the default matches production.
const CRITIC = process.argv.includes('--critic')

const now = new Date()
const pad = n => String(n).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'thesis-eval')
const outFile = path.join(outDir, `${label}-${today}.md`)

async function postJson(url, payload, extraHeaders = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON error body */ }
    return { res, json, text }
  } finally {
    clearTimeout(timer)
  }
}

const QUOTA_RE = /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i

// Two steps, as the page does: the analyse route (signals), then /api/thesis (written read).
async function analyse(thesis) {
  const started = Date.now()
  try {
    const first = await postJson(`${BASE_URL}/api/analyse`, { thesis, skipThesis: true })
    if (!first.res.ok || !first.json) {
      const body = (first.json?.detail ?? first.json?.error ?? first.text).toString()
      return { ok: false, quota: first.res.status === 429 || QUOTA_RE.test(body), seconds: (Date.now() - started) / 1000, error: `analyse HTTP ${first.res.status}: ${body.slice(0, 500)}` }
    }
    const data = first.json
    const analyseSeconds = (Date.now() - started) / 1000
    if (!data.thesis_inputs) return { ok: true, seconds: analyseSeconds, analyseSeconds, data, thesisSeconds: 0, sources: [], meta: null }

    const t0 = Date.now()
    const second = await postJson(`${BASE_URL}/api/thesis`, CRITIC ? { ...data.thesis_inputs, critic: true } : data.thesis_inputs, { Origin: BASE_URL })
    const thesisSeconds = (Date.now() - t0) / 1000
    const seconds = (Date.now() - started) / 1000
    if (!second.res.ok || !second.json) {
      const body = (second.json?.detail ?? second.json?.error ?? second.text).toString()
      return { ok: false, quota: second.res.status === 429 || QUOTA_RE.test(body), seconds, error: `thesis HTTP ${second.res.status}: ${body.slice(0, 500)}` }
    }
    const meta = second.json.meta ?? null
    return {
      ok: true,
      quota: Boolean(meta?.quota_error),
      seconds,
      analyseSeconds,
      thesisSeconds,
      data: { ...data, thesis: second.json.thesis },
      sources: second.json.thesis_sources ?? [],
      meta,
    }
  } catch (err) {
    const seconds = (Date.now() - started) / 1000
    const msg = err?.name === 'AbortError' ? `Timed out after ${TIMEOUT_MS} ms` : (err?.cause?.code ?? err?.message ?? String(err))
    return { ok: false, quota: false, seconds, error: msg }
  }
}

function section(index, thesis, result) {
  const head = `## ${index + 1}. ${thesis}\n\n`
  if (!result.ok) {
    return `${head}**${result.quota ? 'QUOTA ERROR (not a quality result)' : 'FAILED'}** after ${result.seconds.toFixed(1)}s: ${result.error}\n`
  }
  const d = result.data
  const s = d.stats ?? {}
  const m = result.meta
  const lines = [
    head,
    result.quota ? `**QUOTA ERROR (not a quality result):** the writing model hit a quota or rate limit during this thesis; the text below may be a facts-only fallback.\n\n` : '',
    `- Sector / geography parsed: ${d.sector ?? 'n/a'} / ${d.geography ?? 'n/a'}\n`,
    `- Signal tier: ${d.signal_tier ?? 'n/a'}\n`,
    `- Deals: ${s.count_30d ?? 'n/a'} (30d), ${s.count_90d ?? 'n/a'} (90d), ${s.count_365d ?? 'n/a'} (12m), ${s.count_prior_90d ?? 'n/a'} (prior 90d)\n`,
    `- Source count: ${s.source_count ?? 'n/a'}\n`,
    `- Media mentions (90d): ${s.media_mentions_90d ?? 'n/a'}\n`,
    `- Response time: ${result.seconds.toFixed(1)}s (analyse ${result.analyseSeconds.toFixed(1)}s, thesis ${result.thesisSeconds.toFixed(1)}s)\n`,
  ]
  if (m) {
    lines.push(
      `- Model calls: ${m.model_calls}; retry ran: ${m.retry_ran ? 'yes' : 'no'}; facts-only fallback: ${m.fallback ? `yes (${m.fallback_reason})` : 'no'}\n`,
      `- Evidence entries: ${m.evidence_available} available, ${m.evidence_cited} cited, ${m.evidence_headline_only} headline-only\n`,
      `- Violations after final draft: ${m.hard_violations} hard, ${m.soft_violations} uncited-fact flags; critic issues: ${m.critic_issues}; sections with content: ${m.sections_with_content}/7\n`,
    )
  }
  lines.push(`\n### premia_read\n\n${d.premia_read ?? '(missing)'}\n\n`, `### thesis\n\n${d.thesis ?? '(missing)'}\n`)
  if (result.sources.length > 0) {
    lines.push(`\n### sources\n\n${result.sources.map(src => `${src.n}. ${src.text}${src.source ? ` — ${src.source}` : ''}${src.date ? `, ${src.date}` : ''}${src.url ? ` <${src.url}>` : ''} (${src.type})`).join('\n')}\n`)
  }
  return lines.join('')
}

async function main() {
  console.log(`Evaluating ${THESES.length} theses against ${BASE_URL} (pause ${PAUSE_MS} ms between theses)`)
  const parts = []
  let failures = 0
  let quotaErrors = 0
  let fallbacks = 0
  const quality = { available: 0, cited: 0, headline: 0, count: 0 }
  for (const [i, thesis] of THESES.entries()) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
    process.stdout.write(`[${i + 1}/${THESES.length}] ${thesis} ... `)
    const result = await analyse(thesis)
    if (result.quota) quotaErrors++
    else if (!result.ok) failures++
    else {
      if (result.meta?.fallback) fallbacks++
      if (result.meta) {
        quality.available += result.meta.evidence_available
        quality.cited += result.meta.evidence_cited
        quality.headline += result.meta.evidence_headline_only
        quality.count++
      }
    }
    console.log(result.quota ? `QUOTA ERROR (${result.seconds.toFixed(1)}s)` : result.ok ? `ok (${result.seconds.toFixed(1)}s)` : `FAILED: ${result.error}`)
    parts.push(section(i, thesis, result))
  }

  const succeeded = THESES.length - failures - quotaErrors
  const header = [
    `# Thesis evaluation: ${label}\n\n`,
    `- Date: ${today}\n`,
    `- Target: ${BASE_URL}/api/analyse (skipThesis) then /api/thesis\n`,
    `- Theses: ${THESES.length} (${succeeded} counted as quality results, ${quotaErrors} quota errors, ${failures} other failures)\n`,
    `- Quota errors affected ${quotaErrors} of ${THESES.length} theses; they are excluded from the quality results.\n`,
    `- Facts-only fallbacks among quality results: ${fallbacks}\n`,
    quality.count > 0
      ? `- Evidence use across quality results: ${quality.available} entries available, ${quality.cited} cited, ${quality.headline} headline-only\n\n`
      : '\n',
    `---\n\n`,
  ].join('')

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, header + parts.join('\n---\n\n'), 'utf8')
  console.log(`Saved ${path.relative(root, outFile)}`)
  console.log(`Quota errors: ${quotaErrors} of ${THESES.length}; other failures: ${failures}`)
  if (failures + quotaErrors === THESES.length) process.exitCode = 1
}

main()
