import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseThesisMarkdown } from '../lib/thesis/format.js'
import { analyseThesis } from '../lib/thesis/validate.js'
import { premiaReadToneViolation, tierWording } from '../lib/thesis/premiaCheck.js'

test('inline bullets after a citation and sentence end are split onto their own lines', () => {
  const broken = '**What Data Would Change The View:** Watch for more detail [7][8]. * A breakdown of the 64 September 2026 transactions by deal value and buyer type. * The proportion of those 64 deals involving private equity firms.'
  const out = normaliseThesisMarkdown(broken)
  const lines = out.split('\n').filter(Boolean)
  assert.ok(lines.includes('* A breakdown of the 64 September 2026 transactions by deal value and buyer type.'))
  assert.ok(lines.includes('* The proportion of those 64 deals involving private equity firms.'))
})

test('glued bold labels start their own paragraph, even after a citation', () => {
  const broken = '**The Reality:** Deals are few [8]. **The Macro Context:** Rules matter [3].**The Execution Angle:** Advisors should wait [4].'
  const out = normaliseThesisMarkdown(broken)
  assert.equal(out, '**The Reality:** Deals are few [8].\n\n**The Macro Context:** Rules matter [3].\n\n**The Execution Angle:** Advisors should wait [4].')
})

test('who-should-care labels are separated and a bullet-leading label is left alone', () => {
  const out = normaliseThesisMarkdown('## Who Should Care\n* **Investors:** Wait. **Founders:** Raise.')
  assert.match(out, /Investors:\*\* Wait\.\n\n\*\*Founders:\*\* Raise\./)
  assert.match(out, /^\* \*\*Investors/m)
})

const entries = [
  { id: 'E1', date: '2018-11-01', type: 'research', text: 'old' },
  { id: 'E2', date: '2026-09-01', type: 'research', text: 'new' },
]

test('an entry older than 24 months cited in a current section is removed; elsewhere it is kept', () => {
  const text = '## Sector Overview\nBuyers did 35 of 44 deals [E1]. Strategics lead [E2].\n## Market Brief\nIn 2018, buyers did 35 of 44 deals [E1].'
  const { violations, cleaned } = analyseThesis(text, { entryIds: ['E1', 'E2'], signalTier: 'solid', entries })
  assert.ok(violations.some(v => v.type === 'old_entry_in_current_section' && v.hard))
  assert.ok(!cleaned.includes('35 of 44 deals [E1]. Strategics'))
  assert.match(cleaned, /Strategics lead \[E2\]/)
  assert.match(cleaned, /In 2018, buyers did 35 of 44 deals \[E1\]/)
})

test('premia read: overstated, unsupported consolidation and generic risk are rejected', () => {
  assert.equal(tierWording('limited'), 'limited deal activity')
  assert.equal(premiaReadToneViolation('Sufficient deal activity supports a view.', { tier: 'limited' }), 'overstated_for_tier')
  assert.equal(premiaReadToneViolation('Consolidation is under way.', { tier: 'active', headlines: ['A buys B'] }), 'unsupported_consolidation')
  assert.equal(premiaReadToneViolation('Consolidation is under way.', { tier: 'active', headlines: ['Sector consolidation continues'] }), null)
  assert.equal(premiaReadToneViolation('The main risk is macroeconomic shocks.', { tier: 'active' }), 'generic_risk')
  assert.equal(premiaReadToneViolation('Two buyers are active in the tracked headlines.', { tier: 'limited', headlines: [] }), null)
})
