import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIGNAL_THRESHOLDS,
  calculateMomentum,
  getSignalTier,
  hasDocumentedPriorPeak,
  shouldShowDealTrend,
  toPercentages,
} from '../lib/signalLogic.js'

function stats(overrides) {
  return { deals90d: 0, sourceCount: 0, activeMonths: 0, confidence: 20, ...overrides }
}

test('getSignalTier returns insufficient when two core minimums fail', () => {
  assert.equal(getSignalTier(stats({ deals90d: 0, sourceCount: 1, activeMonths: 1, confidence: 80 })), 'insufficient')
})

test('getSignalTier returns insufficient below confidence threshold', () => {
  assert.equal(getSignalTier(stats({ deals90d: 2, sourceCount: 2, activeMonths: 1, confidence: SIGNAL_THRESHOLDS.MIN_CONFIDENCE_FOR_STAGE - 1 })), 'insufficient')
})

test('getSignalTier returns partial when only one core minimum fails', () => {
  assert.equal(getSignalTier(stats({ deals90d: 2, sourceCount: 1, activeMonths: 1, confidence: 35 })), 'partial')
})

test('getSignalTier returns sufficient at threshold boundaries', () => {
  assert.equal(getSignalTier(stats({ deals90d: 2, sourceCount: 2, activeMonths: 1, confidence: 20 })), 'sufficient')
})

test('calculateMomentum returns null when prior period is zero', () => {
  assert.equal(calculateMomentum(0, 0), null)
  assert.equal(calculateMomentum(4, 0), null)
})

test('toPercentages rounds buyer shares to exactly 100%', () => {
  const percentages = toPercentages([1, 1, 1, 0, 11])
  assert.deepEqual(percentages, [7, 7, 7, 0, 79])
  assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100)
})

test('toPercentages returns zeroes for an empty sample', () => {
  assert.deepEqual(toPercentages([0, 0, 0]), [0, 0, 0])
})

test('exhausted requires a documented prior peak', () => {
  assert.equal(hasDocumentedPriorPeak([{ deal_count: 0 }, { deal_count: 0 }, { deal_count: 0 }], 0), false)
  assert.equal(hasDocumentedPriorPeak([{ deal_count: 2 }, { deal_count: 1 }, { deal_count: 0 }, { deal_count: 1 }], 1), true)
})

test('chart visibility requires at least two non-zero months and variance', () => {
  assert.equal(shouldShowDealTrend([{ deal_count: 0 }, { deal_count: 0 }]), false)
  assert.equal(shouldShowDealTrend([{ deal_count: 1 }, { deal_count: 1 }]), false)
  assert.equal(shouldShowDealTrend([{ deal_count: 0 }, { deal_count: 1 }, { deal_count: 2 }]), true)
})
