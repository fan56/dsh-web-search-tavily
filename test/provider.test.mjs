/**
 * Unit tests for TavilySearchProvider: response mapping, availability, request
 * shape, and the error/cancellation contract of the ctx.web seam.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { WebError } from '@deepseek-ai/dsh-web'
import { TavilySearchProvider, TAVILY_API_MAX_RESULTS, mapTavilyResponse } from '../lib/provider.js'

const OPTIONS = {
  apiKey: 'tvly-test',
  baseURL: 'https://api.tavily.com',
  searchDepth: 'basic',
  topic: 'general',
  maxResults: 8,
  includeAnswer: true,
}

function newProvider(overrides = {}) {
  return new TavilySearchProvider(() => ({ ...OPTIONS, ...overrides }))
}

/** Capture fetch calls; respond with the given status/body or throw. */
function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return handler({ url, init })
  }
  return calls
}

const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('mapTavilyResponse maps answer to content and results to sources', () => {
  const result = mapTavilyResponse({
    query: 'q',
    answer: 'the answer',
    response_time: 0.8,
    results: [
      { title: 'A', url: 'https://a.example', content: 'snippet a', score: 0.9 },
      { url: 'https://b.example' },
      { title: '', url: 'https://c.example', content: '' },
    ],
  })
  assert.equal(result.content, 'the answer')
  assert.equal(result.truncated, false)
  assert.deepEqual(result.sources, [
    { url: 'https://a.example', title: 'A', snippet: 'snippet a' },
    { url: 'https://b.example' },
    { url: 'https://c.example' },
  ])
})

test('mapTavilyResponse drops URL-less entries and omits an absent answer', () => {
  const result = mapTavilyResponse({ results: [{ title: 'no url' }] })
  assert.equal('content' in result, false)
  assert.deepEqual(result.sources, [])
})

test('available() requires a credential source and a parseable base URL', () => {
  assert.equal(newProvider().available(), true)
  assert.equal(newProvider({ apiKey: '', resolveApiKey: undefined }).available(), false)
  assert.equal(newProvider({ apiKey: '', resolveApiKey: async () => 'k' }).available(), true)
  assert.equal(newProvider({ baseURL: 'not a url' }).available(), false)
})

test('search() sends the documented request shape and maps the response', async () => {
  const calls = mockFetch(() => jsonResponse(200, {
    answer: 'ans',
    results: [{ title: 'T', url: 'https://t.example', content: 's' }],
  }))
  const result = await newProvider().search({ query: 'hello', maxResults: 5 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.tavily.com/search')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer tvly-test')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(
    { query: body.query, search_depth: body.search_depth, topic: body.topic, max_results: body.max_results, include_answer: body.include_answer },
    { query: 'hello', search_depth: 'basic', topic: 'general', max_results: 5, include_answer: true },
  )
  assert.deepEqual(result.sources, [{ url: 'https://t.example', title: 'T', snippet: 's' }])
  assert.equal(result.content, 'ans')
})

test('search() clamps max_results to the API cap and defaults when absent', async () => {
  const calls = mockFetch(() => jsonResponse(200, { results: [] }))
  await newProvider().search({ query: 'q', maxResults: 99 })
  await newProvider({ maxResults: undefined }).search({ query: 'q' })
  assert.equal(JSON.parse(calls[0].init.body).max_results, TAVILY_API_MAX_RESULTS)
  assert.equal('max_results' in JSON.parse(calls[1].init.body), false)
})

test('search() surfaces an HTTP error detail as WEB_PROVIDER_ERROR', async () => {
  mockFetch(() => jsonResponse(429, { detail: 'rate limited' }))
  await assert.rejects(
    newProvider().search({ query: 'q' }),
    (error) => error instanceof WebError && error.code === 'WEB_PROVIDER_ERROR' && error.message === 'rate limited',
  )
})

test('search() keeps the HTTP status when the error body is unusable', async () => {
  mockFetch(({ init }) => {
    // Simulate a non-JSON body (gateway 5xx): json() throws a plain TypeError.
    return {
      status: 502,
      ok: false,
      json: async () => { throw new TypeError('unexpected token') },
      _init: init,
    }
  })
  await assert.rejects(
    newProvider().search({ query: 'q' }),
    (error) => error instanceof WebError && error.code === 'WEB_PROVIDER_ERROR' && error.message.includes('502'),
  )
})

test('search() annotates a 401 as a rejected key', async () => {
  mockFetch(() => jsonResponse(401, { detail: 'invalid key' }))
  await assert.rejects(
    newProvider().search({ query: 'q' }),
    (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message === 'Tavily rejected the API key (HTTP 401): invalid key',
  )
})

test('search() throws WEB_ABORTED when the signal fires before or during the call', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    newProvider().search({ query: 'q' }, controller.signal),
    (error) => error instanceof WebError && error.code === 'WEB_ABORTED',
  )

  let rejectFetch
  mockFetch(() => new Promise((resolve, reject) => { rejectFetch = reject }))
  const pending = newProvider().search({ query: 'q' })
  await new Promise(resolve => setImmediate(resolve))
  rejectFetch(new DOMException('aborted', 'AbortError'))
  await assert.rejects(
    pending,
    (error) => error instanceof WebError && error.code === 'WEB_ABORTED',
  )
})

test('search() resolves the key through resolveApiKey when no literal is set', async () => {
  const calls = mockFetch(() => jsonResponse(200, { results: [] }))
  await newProvider({ apiKey: undefined, resolveApiKey: async () => 'tvly-resolved' }).search({ query: 'q' })
  assert.equal(calls[0].init.headers.authorization, 'Bearer tvly-resolved')
})

test('search() throws WEB_PROVIDER_CREDENTIAL_MISSING when every source is empty', async () => {
  mockFetch(() => jsonResponse(200, { results: [] }))
  await assert.rejects(
    newProvider({ apiKey: undefined, resolveApiKey: async () => undefined }).search({ query: 'q' }),
    (error) => error instanceof WebError && error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING' && error.message.includes('TAVILY_API_KEY'),
  )
})
