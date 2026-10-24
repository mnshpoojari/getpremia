// Checks that the Premia Read does not contradict the page's own counts about which side is ahead.

const CAPITAL_AHEAD = [
  /\b(capital|money|deals?|deployment|transactions?)\b[^.]{0,40}\b(is|are)?\s*(moving\s+)?(ahead of|before|leading|outpacing|outrunning|running ahead of)\s+(the\s+)?(narrative|media|coverage|commentary|attention)/i,
  /\b(narrative|media|coverage|commentary|attention)\b[^.]{0,30}\b(is|are)?\s*(lagging|trailing|behind)\b[^.]{0,30}\b(capital|deals?|money|transactions?)/i,
  /\bcapital\b[^.]{0,20}\bmoving before\b/i,
]

const NARRATIVE_AHEAD = [
  /\b(narrative|media|coverage|commentary|attention|hype)\b[^.]{0,40}\b(is|are)?\s*(running\s+)?(ahead of|outpacing|outrunning|outstripping|has outrun|have outrun|leading)\s+(the\s+)?(capital|deals?|money|deployment|transactions?)/i,
  /\b(capital|money|deals?|deployment|transactions?)\b[^.]{0,30}\b(is|are)?\s*(lagging|trailing|behind)\b[^.]{0,30}\b(narrative|media|coverage|commentary|attention)/i,
]

// Returns 'capital_ahead' / 'narrative_ahead' when the text asserts the opposite of the counts, otherwise null.
export function premiaReadGapContradiction(text, { deals, media }) {
  const t = String(text ?? '')
  if (media > deals && CAPITAL_AHEAD.some(re => re.test(t))) return 'capital_ahead'
  if (deals > media && NARRATIVE_AHEAD.some(re => re.test(t))) return 'narrative_ahead'
  return null
}

export function gapDirectionLabel({ deals, media }) {
  if (media > deals) return `media mentions are ahead of deals (${media} mentions vs ${deals} deals)`
  if (deals > media) return `deals are ahead of media mentions (${deals} deals vs ${media} mentions)`
  return `deals and media mentions are level (${deals} each)`
}

const LIMITED_TIERS = new Set(['limited', 'insufficient'])
export const isLimitedPremiaTier = tier => LIMITED_TIERS.has(String(tier ?? '').toLowerCase())

// The same wording the thesis uses for thin tracked data.
export function tierWording(tier) {
  return isLimitedPremiaTier(tier) ? 'limited deal activity' : String(tier ?? '')
}

const OVERSTATED_RE = /\b(sufficient (deal )?(activity|data|volume)|strong(ly)? (deal )?(activity|signal|momentum|conviction|evidence|pipeline|flow)|robust (deal )?(activity|signal|flow)|deal activity is strong|clear (trend|momentum))\b/i
const CONSOLIDATION_RE = /\b(consolidat\w*|roll-?ups?|wave of (acquisitions|deals|m&a)|acquisition (wave|trend|spree)|m&a (wave|trend|boom)|buying spree)\b/i
const GENERIC_RISK_RE = /\bmacro-?\s?economic (shocks?|headwinds|uncertaint\w+|volatility|conditions|factors)\b|\bmacro (shocks?|headwinds|uncertaint\w+|volatility)\b|\bgeopolitical (shocks?|tensions|uncertaint\w+)\b/i

// Returns a reason string when the Premia Read overstates thin data, claims consolidation the tracked headlines
// do not show, or closes on a generic macro risk tied to no named evidence. Otherwise null.
export function premiaReadToneViolation(text, { tier, headlines = /** @type {string[]} */ ([]) }) {
  const t = String(text ?? '')
  if (isLimitedPremiaTier(tier) && OVERSTATED_RE.test(t)) return 'overstated_for_tier'
  const m = t.match(CONSOLIDATION_RE)
  if (m) {
    const stem = m[0].toLowerCase().replace(/[^a-z&]/g, '').slice(0, 6)
    const found = headlines.some(h => String(h).toLowerCase().replace(/[^a-z&\s]/g, '').includes(stem) || /roll-?up|consolidat/i.test(String(h)) && /roll|consol/.test(stem))
    if (!found) return 'unsupported_consolidation'
  }
  if (GENERIC_RISK_RE.test(t)) return 'generic_risk'
  return null
}
