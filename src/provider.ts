/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by the Tavily Search API
 * (`POST /search` with `Authorization: Bearer`). It maps `results[].content`
 * to `snippet` and the optional `answer` to the normalized `content`; the
 * current Tavily response carries no publication dates, so `publishedAt` is
 * never set. The wire format and native `fetch` client are provider-private
 * and do not use `ctx.llm`.
 * @module @aiwayds/dsh-web-search-tavily/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { TavilyErrorResponse, TavilyResult, TavilySearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily endpoint; `/search` is appended. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default retrieval depth (1 credit; `advanced` costs 2). */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Default topic routing. */
export const TAVILY_DEFAULT_TOPIC = 'general'

/** Default result count when a request carries no `maxResults`; matches dsh-tool-web's bound. */
export const TAVILY_DEFAULT_MAX_RESULTS = 8

/** Tavily's hard cap on `max_results`. */
export const TAVILY_API_MAX_RESULTS = 20

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-tavily/0.1.0'

/** Retrieval depths accepted by the API. */
export type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'

/** Topic routing accepted by the API. */
export type TavilyTopic = 'general' | 'news' | 'finance'

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface TavilySearchProviderOptions {
  /** Literal Tavily API key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the current Tavily API key for one search operation. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  readonly apiKeyEnv?: CredentialRef
  /** Endpoint base; `/search` is appended. */
  readonly baseURL: string
  /** Retrieval depth sent as the API's `search_depth`. */
  readonly searchDepth: TavilySearchDepth
  /** Topic routing sent as the API's `topic`. */
  readonly topic: TavilyTopic
  /** Default result count when a request carries no `maxResults`. */
  readonly maxResults?: number
  /** Request the LLM-generated `answer` (surfaces as the result's `content`). */
  readonly includeAnswer: boolean
}

/**
 * Map one Tavily result to a normalized source. Entries without a URL cannot
 * be cited and are dropped by {@link mapTavilyResponse}; `content` becomes the
 * portable `snippet` and `title` passes through when non-blank.
 */
export function mapTavilyResult(result: TavilyResult): WebSearchSource | undefined {
  if (typeof result.url !== 'string' || result.url.length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0 ? { snippet: result.content } : {},
  }
}

/**
 * Map a Tavily response envelope to a normalized search result. URL-less
 * entries are dropped; `answer` becomes the optional `content`. The web
 * service owns the final `maxResults` truncation, so this provider reports
 * `truncated: false`.
 */
export function mapTavilyResponse(response: TavilySearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapTavilyResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  return {
    ...response.answer != null && response.answer.length > 0 ? { content: response.answer } : {},
    sources,
    truncated: false,
  }
}

/** Extract a human-readable message from a Tavily error body, when possible. */
function errorDetail(parsed: TavilyErrorResponse): string | undefined {
  const detail = parsed.detail
  if (typeof detail === 'string' && detail.length > 0) return detail
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    const nested = (detail as { readonly message?: unknown }).message
    if (typeof nested === 'string' && nested.length > 0) return nested
  }
  if (typeof parsed.message === 'string' && parsed.message.length > 0) return parsed.message
  return undefined
}

/** Clamp a result count to the API's accepted range. */
function clampMaxResults(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.max(1, Math.min(TAVILY_API_MAX_RESULTS, Math.trunc(value)))
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  /** Options for the NEXT operation, snapshotted once at each operation's entry so one search never mixes two sections. */
  private readonly resolveOptions: () => TavilySearchProviderOptions

  constructor(resolveOptions: () => TavilySearchProviderOptions) {
    this.resolveOptions = resolveOptions
  }

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not mix key and endpoint.
    const options = this.resolveOptions()
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: options.searchDepth,
          topic: options.topic,
          ...clampMaxResults(request.maxResults ?? options.maxResults) !== undefined
            ? { max_results: clampMaxResults(request.maxResults ?? options.maxResults) }
            : {},
          include_answer: options.includeAnswer,
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      throw searchError('Tavily search request failed', error, signal)
    }

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = await response.json() as TavilyErrorResponse
        const detail = errorDetail(parsed)
        if (detail !== undefined) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      }
      if (status === 401) {
        message = `Tavily rejected the API key (HTTP 401): ${message}`
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as TavilySearchResponse
      return mapTavilyResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * A literal key wins; otherwise the credentials seam resolves the reference,
   * with the launch environment as the fallback plane.
   */
  private async resolveApiKey(options: TavilySearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await (options.resolveApiKey?.() ?? Promise.resolve(undefined))
    } catch (error: unknown) {
      throw searchError('Tavily search credential resolution failed', error, signal)
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'TAVILY_API_KEY'
    throw new WebError(
      `Tavily search has no API key for "${ref}"; store it through the credentials service`
      + ' (~/.dsh/.credentials.yaml), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-tavily config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Tavily search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** Wrap a non-abort failure as `WEB_PROVIDER_ERROR`; rethrow aborts as `WEB_ABORTED`. */
function searchError(prefix: string, error: unknown, signal?: AbortSignal): WebError {
  if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
  return new WebError(`${prefix}: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
