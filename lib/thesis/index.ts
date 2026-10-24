import type { MarketContextResult } from '@/lib/queries/marketContext'
import { buildEvidence, type EvidenceDealInput, type EvidenceEntry, type EvidenceStats } from './evidence'
import { ANALYSE_CALL_TIMEOUT_MS, callModel, criticEnabled, GeminiTimeoutError, isQuotaError, MODELS, PREMIA_READ_TIMEOUT_MS, THESIS_DEADLINE_MS } from './config'
import { applySignalSectionGuard } from './guard'
import { runThesisPipeline } from './orchestrate'
import { currentTimer } from './timing'

export { applySignalSectionGuard }

// General-purpose Gemini call used by the analyse route. One retry on failure (not after a timeout, which would double the wait);
// callers choose the model from MODELS. Each attempt is capped: 12 s for premia_read, 25 s for everything else.
export async function generateContent(prompt: string, model: string = MODELS.premiaRead, label?: string): Promise<string> {
  const timeoutMs = label === 'premia_read' ? PREMIA_READ_TIMEOUT_MS : ANALYSE_CALL_TIMEOUT_MS
  try {
    const text = await callModel(model, prompt, { label, timeoutMs })
    console.log('[Gemini] primary ok, chars:', text.length)
    return text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[Gemini] primary failed:', msg.slice(0, 200))
    if (err instanceof GeminiTimeoutError) throw err
    try {
      const text = await callModel(model, prompt, { label, timeoutMs })
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
  guard_ms?: number
  convert_ms?: number
  writer_output_tokens?: number | null
  writer_ms_per_100_tokens?: number | null
}

export type ThesisResult = { thesis: string; thesis_sources: ThesisSource[]; meta: ThesisMeta }

export class ThesisSkipped extends Error {
  constructor() {
    super('thesis generation skipped: cache hit')
    this.name = 'ThesisSkipped'
  }
}

// Evidence -> write -> validate -> cleanup, within a 9 s deadline. The critic and retry only run when THESIS_CRITIC_ENABLED=true.
// `proceed` (optional) resolves false when the finished thesis is already cached; the run then stops before the writer.
export async function generateThesis(params: ThesisParams, opts: { critic?: boolean; deadlineAt?: number; proceed?: Promise<boolean> } = {}): Promise<ThesisResult> {
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
      budgetMs: opts.deadlineAt ? Math.max(0, Math.min(3_000, opts.deadlineAt - Date.now() - 6_000)) : undefined,
    })
    entries = evidence.entries
    evidenceStats = evidence.stats
  } catch (err) {
    evidenceError = err instanceof Error ? err.message : String(err)
    console.error('[thesis] evidence failed:', evidenceError)
  }
  const evidenceMs = Date.now() - startedAt
  // A cache hit decided elsewhere stops the run before the writer call, so a hit costs no writer quota.
  if (opts.proceed && !(await opts.proceed)) throw new ThesisSkipped()
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
    deadlineMs: useCritic ? 56_000 : (opts.deadlineAt ? opts.deadlineAt - startedAt : THESIS_DEADLINE_MS),
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
