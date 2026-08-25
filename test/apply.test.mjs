/**
 * Plugin wiring tests: apply() registration, schema defaults, and option
 * projection (with ctx.get absent so the launch-environment fallback path is
 * exercised through process.env only).
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { apply, Config, inject, name } from '../lib/index.js'
import { TAVILY_PROVIDER_ID } from '../lib/index.js'

test('plugin metadata targets the web seam', () => {
  assert.equal(name, 'web-search-tavily')
  assert.deepEqual(inject, ['web'])
})

test('Config resolves documented defaults', () => {
  const config = Config({})
  assert.equal(config.apiKeyEnv, 'TAVILY_API_KEY')
  assert.equal(config.searchDepth, 'basic')
  assert.equal(config.topic, 'general')
  assert.equal(config.includeAnswer, true)
  assert.equal('maxResults' in config, false)
})

test('apply() registers a tavily provider wired to the resolved config', async () => {
  let registered
  const ctx = {
    get: () => undefined,
    web: { registerSearchProvider: (provider) => { registered = provider } },
  }
  apply(ctx, { apiKey: 'tvly-x', baseURL: 'https://api.tavily.com' })
  assert.equal(registered.id, TAVILY_PROVIDER_ID)
  // A literal key plus a parseable base URL make the provider locally usable
  // without touching any ctx service.
  assert.equal(registered.available(), true)
})
