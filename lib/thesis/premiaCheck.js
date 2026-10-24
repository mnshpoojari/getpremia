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
