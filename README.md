# dsh-web-search-tavily

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) plugin that
provides web search through the [Tavily Search API](https://docs.tavily.com/).

It replaces the default DeepSeek web search — which spends a **full auxiliary model call
per search** (Anthropic-compatible Messages API + `web_search_20250305` server tool) —
with a plain Tavily REST call: ~1s, 1 credit at `basic` depth, no model tokens.

The plugin registers a `WebSearchProvider` (`id: "tavily"`) with the official
[`ctx.web` capability seam](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/web/web),
so everything around the tool stays exactly as shipped: the model still calls the same
`web_search` tool, with the same citation formatting, `searchMaxResults` bound, and
timeout budget. A provider swap changes how the harness reaches the web, nothing else.

## Requirements

- dsh `0.1.1-rc.x` (peer deps resolve to the profile's shared `@deepseek-ai` closure)
- A Tavily API key (`tvly-…`, [free tier available](https://tavily.com))

## Install

Add the package to a dsh profile — `~/.dsh/profiles/<name>/package.json`:

```json
{
  "dependencies": {
    "@aiwayds/dsh-web-search-tavily": "github:fan56/dsh-web-search-tavily"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@aiwayds/dsh-web-search-tavily"]
    }
  }
}
```

then `pnpm install` in the profile directory and restart dsh.

For local development use a filesystem link instead:

```json
"@aiwayds/dsh-web-search-tavily": "link:/path/to/dsh-web-search-tavily"
```

> `@deepseek-ai/*` packages are **peer dependencies by design**: they must resolve to
> the profile's single shared dsh closure (`link-dsh-closure`). Putting them in
> `dependencies` installs a second cordis instance and crashes the loader.

## Configure

**1. API key.** Store the key in dsh's managed credentials document
(`~/.dsh/.credentials.yaml`) — resolved per search, never written to config files:

```yaml
version: 1
refs:
  TAVILY_API_KEY: tvly-xxxxxxxx
```

Fallbacks, in resolution order: `TAVILY_API_KEY` in the launching environment, then a
literal `apiKey` in the plugin config (discouraged).

**2. Select the provider.** The base bundle pins `web.searchProvider` to
`deepseek-official`, and a configured id always wins — so add the override to the
profile's `cordis.patch.yml` (or the home-level `~/.dsh/cordis.patch.yml` for every
profile):

```yaml
- id: web
  config:
    searchProvider: tavily
```

Optionally retire the DeepSeek search plugin entirely:

```yaml
- id: web-search-deepseek
  disabled: true
```

Restart dsh. **Verify** the composed tree:

```sh
dsh --profile <name> --dump-config | grep -A3 'id: web$'   # searchProvider: tavily
```

**Rollback:** delete the patch entries and restart — `web_search` returns to the
shipped DeepSeek provider.

**Plugin config** (all optional; via a patch layer, read at startup):

| Field | Default | Notes |
|---|---|---|
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference resolved per search |
| `apiKey` | — | Literal key; wins over the reference |
| `baseURL` | `https://api.tavily.com` | Env override: `TAVILY_BASE_URL` |
| `searchDepth` | `basic` | `basic` / `advanced` (2 credits) / `fast` / `ultra-fast` |
| `topic` | `general` | `general` / `news` / `finance` |
| `maxResults` | `8` | Default when the tool sends no bound; API caps at 20 |
| `includeAnswer` | `true` | Tavily's generated answer becomes the result's `content` |

Example patch entry with config:

```yaml
- insert:
    - id: web-search-tavily
      name: '@aiwayds/dsh-web-search-tavily'
      config:
        searchDepth: advanced
        topic: news
```

## Behavior

- `results[].content` → the portable `snippet`; Tavily's `answer` → the result's
  `content`; the API returns no publication dates, so `publishedAt` is never set.
- Follows the `ctx.web` seam contract: cancellation as `WEB_ABORTED`, a missing key as
  `WEB_PROVIDER_CREDENTIAL_MISSING` (naming `TAVILY_API_KEY`), provider failures as
  `WEB_PROVIDER_ERROR` with Tavily's own error detail surfaced; a rejected key reads
  `Tavily rejected the API key (HTTP 401)`.
- `available()` is a local check only (credential source present, base URL parseable) —
  it never makes network calls.
- Result-count requests are clamped to Tavily's `max_results` cap (20); the seam
  additionally enforces the tool's `searchMaxResults` bound (default 8).

## Develop

```sh
npm install
npm run check   # tsc --noEmit
npm test        # build + node --test (14 tests)
```

After editing `src/`, run `npm run build` and restart dsh — the plugin loads from
`lib/`. Unit tests cover response mapping, availability, the request shape, and the
HTTP/abort/credential error branches with mocked `fetch`.

## License

MIT
