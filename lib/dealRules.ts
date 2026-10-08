import rules from '@/shared/deal-rules.json'

const exclusions = rules.exclusions.map(({ reason, pattern }) => ({
  reason,
  pattern: new RegExp(pattern, 'i'),
}))
const transactionPattern = new RegExp(rules.transaction_pattern, 'i')
const financingVerbPattern = /\b(?:raises?|raised|secures?|secured)\b/i
const financingSupportPattern = /\b(?:raises?|raised|secures?|secured)\s+(?:(?:us|usd)\s*)?\$\s*[\d,.]+|\b(?:funding\s+round|series\s+[abc])\b/i

export type DealRejectReason = 'listicle' | 'market_report' | 'opinion' | 'not_a_transaction'

export function cleanDealHeadline(title: string): string {
  return title.trim().replace(/\s+-\s+[^-]{2,100}\s*$/, '').trim()
}

export function dealExclusionReason(
  title: string,
  domain = '',
  source = '',
): DealRejectReason | null {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '')
  const normalizedSource = source.toLowerCase()
  const blockedPublisher = rules.market_research_publishers.some(blocked =>
    normalizedDomain === blocked ||
    normalizedDomain.endsWith(`.${blocked}`) ||
    normalizedSource.includes(blocked),
  )
  if (blockedPublisher) return 'market_report'

  const headline = cleanDealHeadline(title)
  for (const exclusion of exclusions) {
    if (exclusion.pattern.test(headline)) return exclusion.reason as DealRejectReason
  }
  return null
}

export function hasDealTransactionPhrase(title: string): boolean {
  const headline = cleanDealHeadline(title)
  return transactionPattern.test(headline) &&
    (!financingVerbPattern.test(headline) || financingSupportPattern.test(headline))
}
