export const SIGNAL_ANALYSIS_CONFIG = {
  thresholds: {
    MIN_DEALS_FOR_STAGE: 3,
    MIN_SOURCES_FOR_STAGE: 2,
    MIN_ACTIVE_MONTHS: 1,
    MIN_CONFIDENCE_FOR_STAGE: 20,
    MIN_MENTIONS_FOR_VELOCITY: 20,
  },
  bannedSignalPhrases: ['emerging', 'consensus', 'trend', 'outpacing', 'consolidation', 'momentum'],
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeSignalSection(sectionText, signalTier) {
  const lowerTier = signalTier.toLowerCase()
  if (lowerTier !== 'insufficient' && lowerTier !== 'limited') return sectionText

  const bannedRegex = new RegExp(`\\b(?:${SIGNAL_ANALYSIS_CONFIG.bannedSignalPhrases.map(escapeRegex).join('|')})\\b`, 'gi')
  const stripped = sectionText.replace(bannedRegex, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()
  const prefix = 'Tracked data remains thin here, so this section only records what the sources actually show and what would need to change to justify a stronger call.'
  return stripped ? `${prefix}\n\n${stripped}` : prefix
}

export function applySignalSectionGuard(thesisText, signalTier) {
  const signalHeading = /##\s*What our sources show\s*\n/mi
  const defaultSignalBody = signalTier.toLowerCase() === 'insufficient' || signalTier.toLowerCase() === 'limited'
    ? 'Tracked data remains thin here; this section records only the counts, dates, and sources actually observed and flags what would need to change to support a stronger read.'
    : 'Tracked data supports a clear signal here. This section records exactly what the dataset confirms: counts, dates, sources, and any relevant caveats.'

  if (!signalHeading.test(thesisText)) {
    return `${thesisText.trim()}\n\n## What our sources show\n\n${sanitizeSignalSection(defaultSignalBody, signalTier)}`
  }

  const sections = thesisText.split(/(?=^##\s+)/m)
  const signalIndex = sections.findIndex(section => /^##\s*What our sources show\s*$/mi.test(section.trim()))
  if (signalIndex === -1) return thesisText

  const heading = sections[signalIndex].split('\n')[0]
  const body = sections[signalIndex].slice(heading.length).trim()
  const guardedBody = sanitizeSignalSection(body, signalTier)
  sections[signalIndex] = `${heading}\n\n${guardedBody}`
  return sections.join('')
}
