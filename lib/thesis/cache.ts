import type { ThesisResult } from './index'

// Finished-thesis cache: normalised thesis text + day. All failures are swallowed; the cache is an optimisation only.

export function thesisCacheKey(userInput: string): string {
  return userInput.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300)
}

function headers(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!process.env.SUPABASE_URL || !key) return null
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }
}

const today = () => new Date().toISOString().slice(0, 10)

function isThesisResult(v: unknown): v is ThesisResult {
  const r = v as ThesisResult | null
  return Boolean(r) && typeof r?.thesis === 'string' && Array.isArray(r?.thesis_sources) && typeof r?.meta === 'object' && r.meta !== null
}

export async function readThesisCache(userInput: string): Promise<ThesisResult | null> {
  const h = headers()
  if (!h) return null
  try {
    const params = new URLSearchParams({ select: 'result', thesis_key: `eq.${thesisCacheKey(userInput)}`, day: `eq.${today()}`, limit: '1' })
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/thesis_cache?${params}`, { headers: h, signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const rows = (await res.json()) as { result: unknown }[]
    return isThesisResult(rows[0]?.result) ? rows[0].result : null
  } catch {
    return null
  }
}

// Facts-only fallbacks and quota errors must never be cached.
export function isCacheable(result: ThesisResult): boolean {
  return !result.meta.fallback && !result.meta.quota_error && result.thesis.trim().length > 0
}

export async function writeThesisCache(userInput: string, result: ThesisResult): Promise<void> {
  const h = headers()
  if (!h || !isCacheable(result)) return
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/thesis_cache?on_conflict=thesis_key,day`, {
      method: 'POST',
      headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ thesis_key: thesisCacheKey(userInput), day: today(), result }),
      signal: AbortSignal.timeout(3000),
    })
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/thesis_cache?day=lt.${cutoff}`, {
      method: 'DELETE',
      headers: { ...h, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // non-fatal
  }
}
