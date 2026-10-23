import type { MarketContextResult } from '@/lib/queries/marketContext'
import { buildEvidence, type EvidenceDealInput, type EvidenceEntry, type EvidenceStats } from './evidence'
import { callModel, criticEnabled, isQuotaError, MODELS, THESIS_DEADLINE_MS } from './config'
import { applySignalSectionGuard } from './guard'
import { runThesisPipeline } from './orchestrate'
import { currentTimer } from './timing'

export { applySignalSectionGuard }

// General-purpose Gemini call used by the analyse route. One retry on failure; callers choose the model from MODELS.
export async function generateContent(prompt: string, model: string = MODELS.premiaRead, label?: string): Promise<string> {
  try {
    const text = await callModel(model, prompt, { label })
    console.log('[Gemini] primary ok, chars:', text.length)
    return text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[Gemini] primary failed:', msg.slice(0, 200))
    try {
      const text = await callModel(model, prompt, { label })
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
  writer_ms: number
  validator_ms: number
}

export type ThesisResult = { thesis: string; thesis_sources: ThesisSource[]; meta: ThesisMeta }

// Evidence -> write -> validate -> cleanup, within a 9 s deadline. The critic and retry only run when THESIS_CRITIC_ENABLED=true.
export async function generateThesis(params: ThesisParams, opts: { critic?: boolean } = {}): Promise<ThesisResult> {
  const startedAt = Date.now()
  let entries: EvidenceEntry[] = []
  let evidenceStats: EvidenceStats | null = null
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
    evidenceStats = evidence.stats
  } catch (err) {
    evidenceError = err instanceof Error ? err.message : String(err)
    console.error('[thesis] evidence failed:', evidenceError)
  }
  const evidenceMs = Date.now() - startedAt
  const useCritic = opts.critic ?? criticEnabled()

  const result = await runThesisPipeline({
    params,
    entries,
    writerModel: MODELS.writer,
    criticModel: MODELS.critic,
    call: callModel,
    isQuota: isQuotaError,
    startedAt,
    criticEnabled: useCritic,
    deadlineMs: useCritic ? 56_000 : THESIS_DEADLINE_MS,
  }) as ThesisResult

  const timer = currentTimer()
  console.log('[thesis]', JSON.stringify({
    thesis: params.userInput.slice(0, 80),
    writer_model: MODELS.writer,
    critic_model: useCritic ? MODELS.critic : null,
    ...result.meta,
    evidence_ms: evidenceMs,
    evidence_stats: evidenceStats,
    stages: timer?.summary().stages,
    thinking_tokens: timer?.summary().thinking_tokens,
    evidence_error: evidenceError,
    total_ms: Date.now() - startedAt,
  }))
  return result
}
