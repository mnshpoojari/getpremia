import test from 'node:test'
import assert from 'node:assert/strict'
import { GeminiTimeoutError, withModelTimeout } from '../lib/thesis/timeout.js'

const slow = ms => new Promise(resolve => setTimeout(() => resolve('late'), ms))

test('a slow model call is rejected at the timeout and logged with its label', async () => {
  const logs = []
  const started = Date.now()
  await assert.rejects(
    withModelTimeout(slow(500), 40, 'premia_read', m => logs.push(m)),
    err => err instanceof GeminiTimeoutError && err.label === 'premia_read' && err.timeoutMs === 40,
  )
  assert.ok(Date.now() - started < 300)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[gemini-timeout\] premia_read after 40ms$/)
})

test('a fast call returns normally and does not log', async () => {
  const logs = []
  assert.equal(await withModelTimeout(slow(5), 200, 'parse', m => logs.push(m)), 'late')
  assert.deepEqual(logs, [])
})

test('a call that fails before the timeout keeps its own error', async () => {
  await assert.rejects(withModelTimeout(Promise.reject(new Error('429 quota')), 200, 'x', () => {}), /429 quota/)
})

test('no timeout value means the promise is returned untouched', async () => {
  assert.equal(await withModelTimeout(Promise.resolve('ok'), 0, 'x'), 'ok')
})

test('a timeout is not mistaken for a quota error but still reaches fallbacks as a thrown error', async () => {
  const err = await withModelTimeout(slow(200), 10, 'relevance', () => {}).catch(e => e)
  assert.ok(err instanceof Error)
  assert.doesNotMatch(err.message, /429|quota/i)
})
