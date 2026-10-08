import test from 'node:test'
import assert from 'node:assert/strict'
import { selectThemePeers } from '../lib/themePeerLogic.mjs'

const peers = Array.from({ length: 6 }, (_, index) => ({
  sector: `Sector ${index}`,
  country: 'IN',
  deals_90d: index + 1,
  mentions_90d: index * 2,
}))

test('peer cut-offs are medians of the returned peer set', () => {
  const result = selectThemePeers(
    peers,
    'Fintech',
    'IN',
    {},
  )

  assert.equal(result.peer_set, 'country')
  assert.equal(result.peers.length, 6)
  assert.deepEqual(result.medians, { deals_90d: 3.5, mentions_90d: 5 })
})

test('falls back to same-sector peers worldwide when local peers are insufficient', () => {
  const rows = [
    { sector: 'Fintech', country: 'IN', deals_90d: 2, mentions_90d: 3 },
    ...Array.from({ length: 6 }, (_, index) => ({
      sector: 'Fintech',
      country: `C${index}`,
      deals_90d: index + 1,
      mentions_90d: index + 2,
    })),
  ]
  const result = selectThemePeers(rows, 'Fintech', 'IN', {})

  assert.equal(result.peer_set, 'sector_worldwide')
  assert.equal(result.peers.length, 6)
  assert.deepEqual(result.medians, { deals_90d: 3.5, mentions_90d: 4.5 })
})

test('uses country roll-up peers when enough regional themes are available', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    sector: `Sector ${index}`,
    country: 'SA',
    deals_90d: index + 1,
    mentions_90d: index + 1,
  }))
  const result = selectThemePeers(rows, 'Fintech', 'AE', { GCC: ['AE', 'SA'] })

  assert.equal(result.peer_set, 'region')
  assert.equal(result.peers.length, 6)
})

test('returns no peers and a reason when fewer than six exist', () => {
  const result = selectThemePeers(
    [{ sector: 'Fintech', country: 'IN', deals_90d: 3, mentions_90d: 4 }],
    'Fintech',
    'IN',
    {},
  )

  assert.deepEqual(result.peers, [])
  assert.equal(result.medians, null)
  assert.equal(result.reason, 'fewer_than_six_peers')
  assert.equal(result.available_peer_count, 0)
})
