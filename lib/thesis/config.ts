import { GoogleGenerativeAI } from '@google/generative-ai'

// Single place to choose the models used for the written thesis.
// Override with THESIS_WRITER_MODEL / THESIS_CRITIC_MODEL (any Gemini model name).
export const THESIS_WRITER_MODEL = process.env.THESIS_WRITER_MODEL || 'gemini-2.5-flash'
export const THESIS_CRITIC_MODEL = process.env.THESIS_CRITIC_MODEL || 'gemini-2.5-flash'

let client: GoogleGenerativeAI | null = null
function getClient(): GoogleGenerativeAI {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return client
}

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i.test(msg)
}

export type CallModelOptions = { json?: boolean; timeoutMs?: number; temperature?: number }

export async function callModel(model: string, prompt: string, opts: CallModelOptions = {}): Promise<string> {
  const generativeModel = getClient().getGenerativeModel({
    model,
    generationConfig: {
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    },
  })
  const call = generativeModel.generateContent(prompt).then(result => result.response.text())
  if (!opts.timeoutMs) return call
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`model call timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
  })
  try {
    return await Promise.race([call, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
