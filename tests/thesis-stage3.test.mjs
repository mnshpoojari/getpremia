import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseThesisMarkdown } from '../lib/thesis/format.js'
import { applySignalSectionGuard } from '../lib/thesis/guard.js'
import { analyseThesis } from '../lib/thesis/validate.js'
import { inferEvidenceDate, entryAgeMonths, isOldEntry, searchResultEntries } from '../lib/thesis/evidenceParse.js'
import { premiaReadGapContradiction, gapDirectionLabel } from '../lib/thesis/premiaCheck.js'
import { sourceGroups, truncateTitle } from '../lib/thesis/sourceGroups.js'

const NOW = new Date('2026-10-24T00:00:00Z')

test('format: heading glued to the end of a paragraph gets its own line', () => {
  const broken = 'Tracked sources show limited deal activity here.## Who Should Care\nInvestors: watch closely.'
  const out = normaliseThesisMarkdown(broken)
  assert.match(out, /here\.\n\n## Who Should Care\n\nInvestors/)
})

test('format: inline asterisk bullets become separate lines', () => {
  const broken = '**What Data Would Change The View:** * A reversal in deal flow * A decline in media mentions * A new regulator ruling'
  const out = normaliseThesisMarkdown(broken)
  const bullets = out.split('\n').filter(l => l.startsWith('* '))
  assert.equal(bullets.length, 3)
  assert.equal(bullets[0], '* A reversal in deal flow')
  assert.equal(bullets[2], '* A new regulator ruling')
})

test('format: bold labels and existing bullet lists are left alone', () => {
  const ok = '**The Reality:** Two deals.\n\n* One\n* Two'
  assert.equal(normaliseThesisMarkdown(ok), ok)
})

test('guard: the signal section is followed by a blank line before the next heading', () => {
  const text = '## What our sources show\nOld body.\n## Who Should Care\nInvestors: act.'
  const out = applySignalSectionGuard(text, 'insufficient')
  assert.match(out, /\n\n## Who Should Care/)
})

test('evidence dates: result date, then URL year, then newest past year in the text, ignoring forecasts', () => {
  assert.equal(inferEvidenceDate({ publishedDate: '2025-02-03T00:00:00Z', now: NOW }), '2025-02-03')
  assert.equal(inferEvidenceDate({ url: 'https://x.com/2018/11/deal', now: NOW }), '2018-11')
  assert.equal(inferEvidenceDate({ text: 'In 2018 firms bought 35 of 44; forecast to 2034', now: NOW }), '2018')
  assert.equal(inferEvidenceDate({ text: 'no years here', now: NOW }), null)
})

test('evidence age: a bare year only counts as old when it is definitely older than 24 months', () => {
  assert.equal(isOldEntry({ date: '2018-11-05' }, NOW), true)
  assert.equal(isOldEntry({ date: '2025' }, NOW), false)
  assert.equal(isOldEntry({ date: '2023' }, NOW), true)
  assert.equal(isOldEntry({ date: '2024' }, NOW), false)
  assert.equal(isOldEntry({ date: null }, NOW), false)
  assert.equal(entryAgeMonths('2026-10-01', NOW), 0)
})

test('search entries carry the Tavily date', () => {
  const [e] = searchResultEntries([{ title: 'T', content: 'Body text here', url: 'https://a.com/x', publishedDate: '2026-01-02' }], 'research_structure')
  assert.equal(e.date, '2026-01-02')
  assert.equal(e.type, 'research_structure')
})

test('recency check: old entry cited without a year is flagged but the sentence is kept', () => {
  const entries = [{ id: 'E1', date: '2018-11-01' }, { id: 'E2', date: '2026-05-01' }]
  const text = '## Market Brief\n\n**The Reality:** Buyers took 35 of 44 deals [E1]. In 2018, buyers took 35 of 44 deals [E1]. Fresh deal activity continues [E2].'
  const { violations, cleaned } = analyseThesis(text, { entryIds: ['E1', 'E2'], signalTier: 'sufficient', entries })
  const flags = violations.filter(v => v.type === 'old_entry_no_year')
  assert.equal(flags.length, 1)
  assert.equal(flags[0].hard, false)
  assert.match(cleaned, /Buyers took 35 of 44 deals \[E1\]\./)
})

test('premia read: rejects capital-ahead wording when media exceeds deals, and the reverse', () => {
  const capital = 'Capital is moving ahead of the narrative here, which marks early positioning.'
  const narrative = 'Narrative is outpacing capital, which suggests crowding.'
  assert.equal(premiaReadGapContradiction(capital, { deals: 2, media: 9 }), 'capital_ahead')
  assert.equal(premiaReadGapContradiction(capital, { deals: 9, media: 2 }), null)
  assert.equal(premiaReadGapContradiction(narrative, { deals: 9, media: 2 }), 'narrative_ahead')
  assert.equal(premiaReadGapContradiction(narrative, { deals: 2, media: 9 }), null)
  assert.equal(premiaReadGapContradiction('The tracked sample is thin.', { deals: 2, media: 9 }), null)
  assert.match(gapDirectionLabel({ deals: 2, media: 9 }), /media mentions are ahead of deals/)
})

test('sources card: groups by type, keeps numbers, shows headline tag data, no snippet text', () => {
  const long = 'A'.repeat(120)
  const sources = [
    { n: 1, type: 'headline_only', source: 'Reuters', url: 'https://r.com/a', date: '2026-10-16', text: `${long} (headline only; article text not retrieved)` },
    { n: 2, type: 'research_structure', source: 'bain.com', url: 'https://bain.com/x', date: null, text: 'Sector guide: lots of snippet text follows here.' },
    { n: 3, type: 'benchmark', source: null, url: null, date: '2024', text: 'Market size: USD 5 bn in 2024 (scope: global).' },
    { n: 4, type: 'deal_fact', source: 'FT', url: 'https://ft.com/y', date: '2026-09-01', text: 'Buyer: X. Target: Y. Headline: X buys Y.' },
  ]
  const groups = sourceGroups(sources)
  assert.deepEqual(groups.map(g => g.label), ['Deals', 'Research', 'Benchmarks'])
  const deals = groups[0].items
  assert.deepEqual(deals.map(i => i.n), [1, 4])
  assert.equal(deals[0].headlineOnly, true)
  assert.ok(deals[0].title.length <= 90 && deals[0].title.endsWith('…'))
  assert.ok(!deals[0].title.includes('headline only'))
  assert.equal(deals[1].title, 'X buys Y')
  assert.equal(groups[1].items[0].title, 'Sector guide')
  const bench = groups[2].items[0]
  assert.equal(bench.url, null)
  assert.equal(bench.title, 'Market size')
})

test('sources card: no title falls back to the publisher; empty groups are omitted', () => {
  const groups = sourceGroups([{ n: 7, type: 'research_regulation', source: 'gov.uk', url: 'https://gov.uk', date: null, text: 'plain text without colon' }])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items[0].title, 'gov.uk')
  assert.equal(groups[0].items[0].hasTitle, false)
  assert.equal(truncateTitle('short'), 'short')
})
