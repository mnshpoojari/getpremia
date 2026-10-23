import type { MarketContextResult } from '@/lib/queries/marketContext'
import { buildEvidence, type EvidenceDealInput, type EvidenceEntry } from './evidence'
import { callModel, isQuotaError, THESIS_CRITIC_MODEL, THESIS_WRITER_MODEL } from './config'
import { applySignalSectionGuard } from './guard'
import { runThesisPipeline } from './orchestrate'

export { applySignalSectionGuard }

const GENERAL_MODEL = 'gemini-2.5-flash'

// General-purpose Gemini call used by the analyse route (parsing, maturity, Premia read). One retry on failure.
export async function generateContent(prompt: string): Promise<string> {
  try {
    const text = await callModel(GENERAL_MODEL, prompt)
    console.log('[Gemini] primary ok, chars:', text.length)
    return text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[Gemini] primary failed:', msg.slice(0, 200))
    try {
      const text = await callModel(GENERAL_MODEL, prompt)
      console.log('[Gemini] retry ok, chars:', text.length)
      return text
    } catch (retryErr) {
      const rMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      console.error('[Gemini] retry also failed:', rMsg.slice(0, 200))
      throw retryErr
    }
  }
}

export type ThesisParams = {
  userInput: string
  sector: string
  geography: string
  consensusState: string
  count30d: number
  count90d: number
  count365d: number
  mediaCount90d: number
  synthesisItems: { title?: string; url?: string; published_date?: string; source?: string }[]
  marketContext: MarketContextResult | null
  signalTier: string
  confidencePercent: number
  sourceCount: number
  activeMonths: number
  expansionDescription: string | null
}

export type ThesisSource = {
  n: number
  id: string
  type: string
  source: string | null
  url: string | null
  date: string | null
  text: string
}

export type ThesisMeta = {
  model_calls: number
  retry_ran: boolean
  fallback: boolean
  fallback_reason: string | null
  quota_error: boolean
  evidence_available: number
  evidence_cited: number
  evidence_headline_only: number
  hard_violations: number
  soft_violations: number
  critic_issues: number
  sections_with_content: number
}

export type ThesisResult = { thesis: string; thesis_sources: ThesisSource[]; meta: ThesisMeta }

// Evidence -> write -> validate + critic -> one revision -> cleanup. Falls back to a facts-only read.
export async function generateThesis(params: ThesisParams): Promise<ThesisResult> {
  const startedAt = Date.now()
  let entries: EvidenceEntry[] = []
  let evidenceError: string | null = null
  try {
    const evidence = await buildEvidence({
      thesis: params.userInput,
      sector: params.sector,
      geography: params.geography,
      dealItems: params.synthesisItems.filter((i): i is EvidenceDealInput => Boolean(i.title && i.url)),
      marketContext: params.marketContext,
    })
    entries = evidence.entries
  } catch (err) {
    evidenceError = err instanceof Error ? err.message : String(err)
    console.error('[thesis] evidence failed:', evidenceError)
  }

  const result = await runThesisPipeline({
    params,
    entries,
    writerModel: THESIS_WRITER_MODEL,
    criticModel: THESIS_CRITIC_MODEL,
    call: callModel,
    isQuota: isQuotaError,
    startedAt,
  }) as ThesisResult

  console.log('[thesis]', JSON.stringify({
    thesis: params.userInput.slice(0, 80),
    writer_model: THESIS_WRITER_MODEL,
    critic_model: THESIS_CRITIC_MODEL,
    ...result.meta,
    evidence_error: evidenceError,
    total_ms: Date.now() - startedAt,
  }))
  return result
}
