import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import { currentTimer } from './timing'

// Every Gemini model name used by the thesis flow and the analyse route lives here.
// Change a name (or set the env var) to switch models; no other file needs to change.
const LITE = process.env.THESIS_LITE_MODEL || 'gemini-2.5-flash-lite'
const FULL = 'gemini-2.5-flash'

export const MODELS = {
  writer: process.env.THESIS_WRITER_MODEL || FULL,
  critic: process.env.THESIS_CRITIC_MODEL || FULL,
  extraction: process.env.THESIS_EXTRACTION_MODEL || LITE,
  parse: LITE,
  maturity: LITE,
  relevance: process.env.THESIS_RELEVANCE_MODEL || LITE,
  translation: LITE,
  premiaRead: FULL,
} as const

// The critic and the one retry are off by default; set THESIS_CRITIC_ENABLED=true to bring them back.
export function criticEnabled(): boolean {
  return String(process.env.THESIS_CRITIC_ENABLED ?? '').toLowerCase() === 'true'
}

export const THESIS_DEADLINE_MS = 9_000

let client: GoogleGenerativeAI | null = null
function getClient(): GoogleGenerativeAI {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return client
}

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i.test(msg)
}

export type CallModelOptions = {
  json?: boolean
  timeoutMs?: number
  temperature?: number
  // Filled in with the thinking tokens the API reports, so callers can confirm thinking is off.
  usage?: { thinkingTokens?: number; outputTokens?: number }
  label?: string
}

type UsageMetadata = { thoughtsTokenCount?: number; candidatesTokenCount?: number }

// Gemini only. The installed SDK's types do not include thinkingConfig, but it forwards generationConfig as-is,
// so thinkingBudget: 0 reaches the API; the reported thinking-token count is the proof.
export async function callModel(model: string, prompt: string, opts: CallModelOptions = {}): Promise<string> {
  const generationConfig = {
    ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    thinkingConfig: { thinkingBudget: 0 },
  } as GenerationConfig
  const generativeModel = getClient().getGenerativeModel({ model, generationConfig })
  const call = generativeModel.generateContent(prompt).then(result => {
    const usage = result.response.usageMetadata as UsageMetadata | undefined
    const thinking = usage?.thoughtsTokenCount ?? 0
    if (opts.usage) {
      opts.usage.thinkingTokens = thinking
      opts.usage.outputTokens = usage?.candidatesTokenCount
    }
    currentTimer()?.noteThinking(opts.label ?? model, thinking)
    return result.response.text()
  }).catch(err => {
    if (isQuotaError(err)) currentTimer()?.noteQuota(model)
    throw err
  })
  if (!opts.timeoutMs) return call
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`model call timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
  })
  call.catch(() => undefined)
  try {
    return await Promise.race([call, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
