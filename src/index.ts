/**
 * `@aiwayds/dsh-web-search-tavily`: registers a Tavily-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-web-search-exa` does. The key is owned by
 * `@deepseek-ai/dsh-web`.
 *
 * @module @aiwayds/dsh-web-search-tavily
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_DEFAULT_TOPIC,
  TavilySearchProvider,
} from './provider.ts'
import type { TavilySearchDepth, TavilySearchProviderOptions, TavilyTopic } from './provider.ts'

export {
  TAVILY_API_MAX_RESULTS,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_DEFAULT_TOPIC,
  TAVILY_PROVIDER_ID,
  TavilySearchProvider,
} from './provider.ts'
export type { TavilySearchDepth, TavilySearchProviderOptions, TavilyTopic } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Environment variable overriding the endpoint base. */
const BASE_URL_ENV = 'TAVILY_BASE_URL'

/** Plugin config (all optional — `apply` fills credential, env-var, and constant defaults). */
export interface Config {
  /** Literal Tavily API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `TAVILY_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval depth. Defaults to `basic`. */
  searchDepth?: TavilySearchDepth
  /** Topic routing. Defaults to `general`. */
  topic?: TavilyTopic
  /** Default result count when a request carries no `maxResults`. Defaults to 8. */
  maxResults?: number
  /** Request the LLM-generated answer (surfaces as the result's `content`). Defaults to true. */
  includeAnswer?: boolean
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  searchDepth: z.union(['basic', 'advanced', 'fast', 'ultra-fast'] as const).default(TAVILY_DEFAULT_SEARCH_DEPTH),
  topic: z.union(['general', 'news', 'finance'] as const).default(TAVILY_DEFAULT_TOPIC),
  maxResults: z.number().step(1).min(1).max(20),
  includeAnswer: z.boolean().default(true),
})

/**
 * Project one resolved config into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 */
function resolveOptions(ctx: Context, config: Config): TavilySearchProviderOptions {
  const ref = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv: ref,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    topic: config.topic ?? TAVILY_DEFAULT_TOPIC,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : { maxResults: TAVILY_DEFAULT_MAX_RESULTS },
    includeAnswer: config.includeAnswer ?? true,
  }
}

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, config)))
}
