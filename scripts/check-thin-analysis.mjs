import assert from 'node:assert/strict'

const endpoint = process.env.PREMIA_ANALYSE_URL ?? 'http://localhost:3000/api/analyse'
const queries = [
  'financial services in dubai',
  'defence & aerospace',
  process.env.PREMIA_RICH_QUERY ?? 'fintech in United States',
]
const requiredSections = [
  '## Sector Overview',
  '## Market Brief',
  '## Insight Extraction',
  '## Contrarian Lens',
  '## Change Detection',
  '## Who Should Care',
]
const forbiddenSparseClaims = /disinterest|frozen|concluded cycle|cooling\/exhausted|\bquiet\b/i

for (const thesis of queries) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thesis }),
  })
  assert.equal(response.ok, true, `Analysis request failed for "${thesis}" (${response.status})`)
  const result = await response.json()
  const counts = result.stats
  const analysis = `${result.thesis}\n${result.premia_read}`

  for (const section of requiredSections) {
    assert.ok(result.thesis.includes(section), `"${thesis}" omitted ${section}`)
  }
  assert.equal(counts.items_tracked, counts.count_90d + counts.media_mentions_90d, 'Tracked-item total does not match its deal/media components')
  assert.equal(counts.source_count, new Set(counts.source_names).size, 'Header source count does not match the sources used')
  assert.equal(
    counts.source_names.some(source => /google news|news\.google\.com|rss feed/i.test(source)),
    false,
    'Aggregator labels must resolve to publisher sources before counting'
  )
  if (counts.count_90d < result.signal_thresholds.MIN_DEALS_FOR_STAGE) {
    assert.equal(result.signal_tier, 'insufficient', `"${thesis}" received a signal tier below the deal threshold`)
    assert.equal(result.thematic_stage.stage, 'Insufficient data', `"${thesis}" received a stage below the deal threshold`)
  }

  if (result.signal_tier === 'insufficient') {
    assert.equal(result.thematic_stage.stage, 'Insufficient data', `"${thesis}" received a stage below the deal threshold`)
    assert.equal(result.signal_assessment.badge, 'Low (coverage-limited)')
    assert.equal(forbiddenSparseClaims.test(analysis), false, `"${thesis}" contains an unsupported sparse-data market claim`)
  } else {
    assert.notEqual(result.thematic_stage.stage, 'Insufficient data', `"${thesis}" met the signal minimum but was not assigned a stage`)
  }

  const context = result.market_context
  if (context) {
    for (const metric of [context.market_size, context.cagr, context.ev_revenue, context.ev_ebitda]) {
      if (metric.value != null) {
        assert.ok(metric.geography_scope, `"${thesis}" returned an unscoped benchmark`)
      }
    }
  }

  console.log(`\n=== ${thesis} — ${counts.count_90d} deals / ${counts.media_mentions_90d} media / ${counts.source_count} sources (${counts.source_names.join(', ')}) ===`)
  if (queries.indexOf(thesis) < 2) console.log(`${result.premia_read}\n${result.thesis}`)
}
