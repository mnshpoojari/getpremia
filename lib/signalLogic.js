export const SIGNAL_THRESHOLDS = {
  MIN_DEALS_FOR_STAGE: 2,
  MIN_SOURCES_FOR_STAGE: 2,
  MIN_ACTIVE_MONTHS: 1,
  MIN_CONFIDENCE_FOR_STAGE: 20,
}

export function getSignalTier(stats, thresholds = SIGNAL_THRESHOLDS) {
  const deals = Number(stats?.deals90d ?? stats?.count90d ?? 0)
  const sources = Number(stats?.sourceCount ?? stats?.sources ?? 0)
  const activeMonths = Number(stats?.activeMonths ?? 0)
  const confidence = Number(stats?.confidence ?? stats?.confidencePercent ?? 0)
  const failedMinimums = [
    deals < thresholds.MIN_DEALS_FOR_STAGE,
    sources < thresholds.MIN_SOURCES_FOR_STAGE,
    activeMonths < thresholds.MIN_ACTIVE_MONTHS,
  ].filter(Boolean).length

  if (failedMinimums >= 2 || confidence < thresholds.MIN_CONFIDENCE_FOR_STAGE) return 'insufficient'
  if (
    deals >= thresholds.MIN_DEALS_FOR_STAGE &&
    sources >= thresholds.MIN_SOURCES_FOR_STAGE &&
    activeMonths >= thresholds.MIN_ACTIVE_MONTHS
  ) return 'sufficient'
  return 'partial'
}

export function calculateMomentum(current90, prior90) {
  const current = Number(current90 ?? 0)
  const prior = Number(prior90 ?? 0)
  if (prior <= 0) return null
  return (current - prior) / prior
}

export function hasDocumentedPriorPeak(monthlyCounts, current90, minDeals = SIGNAL_THRESHOLDS.MIN_DEALS_FOR_STAGE) {
  const current = Number(current90 ?? 0)
  if (!Array.isArray(monthlyCounts) || monthlyCounts.length === 0) return false
  for (let i = 0; i <= monthlyCounts.length - 3; i += 1) {
    const windowCount = monthlyCounts.slice(i, i + 3).reduce((sum, item) => sum + Number(item?.deal_count ?? item?.count ?? 0), 0)
    if (windowCount >= minDeals && windowCount >= current * 1.5) return true
  }
  return false
}

export function shouldShowSignalGap(mediaMentions, deals) {
  return Number(mediaMentions ?? 0) >= 3 && Number(deals ?? 0) >= 1
}

export function shouldShowDealTrend(monthlyCounts) {
  if (!Array.isArray(monthlyCounts)) return false
  const positive = monthlyCounts.filter(item => Number(item?.deal_count ?? item?.count ?? 0) > 0)
  const values = monthlyCounts.map(item => Number(item?.deal_count ?? item?.count ?? 0))
  return positive.length >= 2 && new Set(values).size > 1
}

export function activeMonthsInWindow(monthlyCounts, months = 3) {
  if (!Array.isArray(monthlyCounts)) return 0
  return monthlyCounts.slice(-months).filter(item => Number(item?.deal_count ?? item?.count ?? 0) > 0).length
}
