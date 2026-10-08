import { NextRequest, NextResponse } from 'next/server'
import universe from '@/ingestion/theme_universe.json'
import { selectThemePeers } from '@/lib/themePeerLogic.mjs'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SNAPSHOT_COLUMNS = [
  'as_of',
  'sector',
  'country',
  'deals_90d',
  'deals_prior_90d',
  'mentions_90d',
  'publishers_90d',
  'country_coverage_items',
  'country_coverage_publishers',
].join(',')
const HISTORY_COLUMNS = 'as_of,deals_90d,mentions_90d'

type ThemeSnapshot = {
  as_of: string
  sector: string
  country: string | null
  deals_90d: number
  deals_prior_90d: number
  mentions_90d: number
  publishers_90d: number
  country_coverage_items: number
  country_coverage_publishers: number
}

type PeerSelection = {
  peers: ThemeSnapshot[]
  peer_set: string
  medians: { deals_90d: number; mentions_90d: number } | null
  reason: string | null
  available_peer_count: number
}

const countryCodes = new Set(universe.countries.map(country => country.code))
const countryNames = new Map(universe.countries.map(country => [country.name.toLowerCase(), country.code]))
const countryNamesByCode = new Map(universe.countries.map(country => [country.code, country.name]))
const regions = universe.regions as Record<string, string[]>
const regionCodes = new Set(Object.keys(regions))
const marketAliases = new Map(
  Object.entries(universe.aliases).map(([alias, code]) => [alias.toLowerCase(), code]),
)

function normalizeCountry(value: string | null): string | null | undefined {
  if (!value || ['global', 'worldwide'].includes(value.trim().toLowerCase())) return null
  const normalized = value.trim()
  const upper = normalized.toUpperCase()
  if (countryCodes.has(upper) || regionCodes.has(upper)) return upper
  return marketAliases.get(normalized.toLowerCase()) ?? countryNames.get(normalized.toLowerCase())
}

async function supabaseGet(path: string): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase service configuration is missing')
  }
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    cache: 'no-store',
  })
}

async function readLatestSnapshots(): Promise<{ asOf: string | null; rows: ThemeSnapshot[] }> {
  const latestResponse = await supabaseGet(
    'theme_snapshots?select=as_of&order=as_of.desc&limit=1',
  )
  if (!latestResponse.ok) {
    throw new Error(`Could not read latest theme snapshot date (${latestResponse.status})`)
  }
  const latest = await latestResponse.json() as Array<{ as_of: string }>
  if (!latest.length) return { asOf: null, rows: [] }

  const asOf = latest[0].as_of
  const params = new URLSearchParams({
    select: SNAPSHOT_COLUMNS,
    as_of: `eq.${asOf}`,
    order: 'sector.asc,country.asc.nullsfirst',
    limit: '1000',
  })
  const rowsResponse = await supabaseGet(`theme_snapshots?${params.toString()}`)
  if (!rowsResponse.ok) {
    throw new Error(`Could not read theme snapshots (${rowsResponse.status})`)
  }
  return { asOf, rows: await rowsResponse.json() as ThemeSnapshot[] }
}

async function readThesisHistory(
  sector: string,
  country: string | null,
  asOf: string,
): Promise<Array<{ as_of: string; deals_90d: number; mentions_90d: number }>> {
  const params = new URLSearchParams({
    select: HISTORY_COLUMNS,
    sector: `eq.${sector}`,
    country: country === null ? 'is.null' : `eq.${country}`,
    as_of: `lte.${asOf}`,
    order: 'as_of.desc',
    limit: '12',
  })
  const response = await supabaseGet(`theme_snapshots?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Could not read thesis snapshot history (${response.status})`)
  }
  return await response.json() as Array<{ as_of: string; deals_90d: number; mentions_90d: number }>
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const thesis = params.get('thesis')?.trim()
  const sector = params.get('sector')?.trim()
  const countryValue = params.get('country')
  const country = normalizeCountry(countryValue)

  if (!thesis || !sector) {
    return NextResponse.json(
      { error: 'thesis and sector are required; country may be a country code, name, region, or global' },
      { status: 400 },
    )
  }
  if (country === undefined) {
    return NextResponse.json({ error: 'country is not in the configured theme universe' }, { status: 400 })
  }

  try {
    const { asOf, rows } = await readLatestSnapshots()
    const thesisRow = rows.find(
      row => row.sector === sector && (row.country ?? null) === country,
    ) ?? null

    if (!asOf) {
      return NextResponse.json({
        thesis,
        this_thesis: null,
        peers: [],
        medians: null,
        reason: 'snapshots_not_available',
        as_of: null,
      })
    }
    if (!thesisRow) {
      return NextResponse.json({
        thesis,
        this_thesis: null,
        peers: [],
        medians: null,
        reason: 'theme_not_qualified',
        as_of: asOf,
      })
    }

    const peerResult: PeerSelection = selectThemePeers(rows, sector, country, regions)
    const thesisSnapshots = await readThesisHistory(sector, country, asOf)
    return NextResponse.json({
      thesis,
      this_thesis: thesisRow,
      ...peerResult,
      peers: peerResult.peers.map(peer => ({
        ...peer,
        thesis: peer.country
          ? `${peer.sector} in ${countryNamesByCode.get(peer.country) ?? peer.country}`
          : peer.sector,
      })),
      thesis_snapshots: thesisSnapshots.reverse(),
      as_of: asOf,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Theme snapshot lookup failed:', message)
    return NextResponse.json({ error: 'Theme snapshot lookup failed' }, { status: 500 })
  }
}
