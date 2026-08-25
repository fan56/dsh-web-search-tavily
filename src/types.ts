/**
 * Wire types for the Tavily Search API (`POST /search`). Only the fields this
 * provider consumes are modeled; unknown fields are ignored by design.
 * @module @aiwayds/dsh-web-search-tavily/types
 */

/** One entry of Tavily's `results[]`. */
export interface TavilyResult {
  readonly title?: string
  readonly url: string
  /** Short description of the result; maps to the seam's `snippet`. */
  readonly content?: string
  readonly score?: number
}

/** The parsed `POST /search` response body. */
export interface TavilySearchResponse {
  readonly query?: string
  /** LLM-generated answer; present only when `include_answer` is set. */
  readonly answer?: string
  readonly results?: readonly TavilyResult[]
  readonly response_time?: number
}

/** Error body shapes observed from the Tavily API (FastAPI-style `detail`). */
export interface TavilyErrorResponse {
  /** FastAPI errors carry `detail` as a string, an object, or a validation array. */
  readonly detail?: unknown
  readonly message?: string
}
