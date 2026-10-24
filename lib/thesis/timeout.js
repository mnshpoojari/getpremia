// Races a promise against a timeout. On timeout it logs "[gemini-timeout] <label>" and rejects with a GeminiTimeoutError.
// Plain JS so the node test runner can import it directly.

export class GeminiTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`model call timed out after ${timeoutMs}ms`)
    this.name = 'GeminiTimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export async function withModelTimeout(promise, timeoutMs, label, log = console.warn) {
  if (!timeoutMs) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      log(`[gemini-timeout] ${label} after ${timeoutMs}ms`)
      reject(new GeminiTimeoutError(label, timeoutMs))
    }, timeoutMs)
  })
  promise.catch(() => undefined)
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
