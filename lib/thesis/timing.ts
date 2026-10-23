import { AsyncLocalStorage } from 'node:async_hooks'

type Stage = { ms: number; calls: number; first: number; last: number }

// Collects wall-clock timings per named stage for one request.
// `ms` is the summed time of every call in the stage; `wall` is first start to last end,
// so parallel calls show up as wall < ms.
export class StageTimer {
  private stages: Record<string, Stage> = {}
  private startedAt = Date.now()
  readonly quotaHits: string[] = []
  readonly thinkingTokens: Record<string, number> = {}

  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      return await fn()
    } finally {
      this.add(name, start, Date.now())
    }
  }

  add(name: string, start: number, end: number) {
    const s = this.stages[name] ?? (this.stages[name] = { ms: 0, calls: 0, first: start, last: end })
    s.ms += end - start
    s.calls++
    s.first = Math.min(s.first, start)
    s.last = Math.max(s.last, end)
  }

  noteQuota(model: string) {
    this.quotaHits.push(model)
  }

  noteThinking(label: string, tokens: number) {
    this.thinkingTokens[label] = (this.thinkingTokens[label] ?? 0) + tokens
  }

  summary() {
    const stages: Record<string, { ms: number; wall: number; calls: number }> = {}
    for (const [name, s] of Object.entries(this.stages)) {
      stages[name] = { ms: s.ms, wall: s.last - s.first, calls: s.calls }
    }
    return {
      stages,
      quota_hits: this.quotaHits,
      thinking_tokens: this.thinkingTokens,
      total_ms: Date.now() - this.startedAt,
    }
  }
}

const store = new AsyncLocalStorage<StageTimer>()

export function runWithTimer<T>(timer: StageTimer, fn: () => Promise<T>): Promise<T> {
  return store.run(timer, fn)
}

export function currentTimer(): StageTimer | undefined {
  return store.getStore()
}

export function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const timer = store.getStore()
  return timer ? timer.time(name, fn) : fn()
}
