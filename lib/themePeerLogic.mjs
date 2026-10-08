export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function relatedMarkets(country, regions) {
  if (!country) return new Set()
  const markets = new Set([country])
  let changed = true
  while (changed) {
    changed = false
    for (const [region, members] of Object.entries(regions)) {
      if (markets.has(region) || members.some(member => markets.has(member))) {
        if (!markets.has(region)) {
          markets.add(region)
          changed = true
        }
        for (const member of members) {
          if (!markets.has(member)) {
            markets.add(member)
            changed = true
          }
        }
      }
    }
  }
  return markets
}

function isThesisRow(row, sector, country) {
  return row.sector === sector && (row.country ?? null) === country
}

export function selectThemePeers(rows, sector, country, regions, minimumPeers = 6) {
  const markets = relatedMarkets(country, regions)
  const preferred = country
    ? rows.filter(row => markets.has(row.country) && !isThesisRow(row, sector, country))
    : []
  const worldwide = rows.filter(
    row => row.sector === sector && row.country !== null && !isThesisRow(row, sector, country),
  )
  const selected = preferred.length >= minimumPeers
    ? {
        peers: preferred,
        peer_set: country in regions
          || Object.values(regions).some(members => members.includes(country))
          ? 'region'
          : 'country',
      }
    : { peers: worldwide, peer_set: 'sector_worldwide' }

  if (selected.peers.length < minimumPeers) {
    return {
      peers: [],
      peer_set: selected.peer_set,
      medians: null,
      reason: 'fewer_than_six_peers',
      available_peer_count: selected.peers.length,
    }
  }

  return {
    peers: selected.peers,
    peer_set: selected.peer_set,
    medians: {
      deals_90d: median(selected.peers.map(row => row.deals_90d)),
      mentions_90d: median(selected.peers.map(row => row.mentions_90d)),
    },
    reason: null,
    available_peer_count: selected.peers.length,
  }
}
