# dsh-web-search-tavily

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) plugin that
provides web search through the [Tavily Search API](https://docs.tavily.com/) — a drop-in
replacement for the default DeepSeek web search that costs one auxiliary model call per
search.

The plugin registers a `WebSearchProvider` (`id: "tavily"`) with the `ctx.web` seam, so the
model-facing `web_search` tool, its citation formatting, and its timeout budget all stay
exactly as shipped.

## Install

Add the package to a dsh profile (`~/.dsh/profiles/<name>/package.json`):

```json
{
  "dependencies": {
    "@aiwayds/dsh-web-search-tavily": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@aiwayds/dsh-web-search-tavily"]
    }
  }
}
```

then `pnpm install` in the profile directory and restart dsh.

> `@deepseek-ai/*` packages are peer dependencies by design: they must resolve to the
> profile's single shared dsh closure, never to a second physical copy.

## Configure

**1. API key.** Store the Tavily key (`tvly-…`) as a credential — the recommended home is
the managed document `~/.dsh/.credentials.yaml`:

```yaml
version: 1
refs:
  TAVILY_API_KEY: tvly-xxxxxxxx
```

Alternatives, in resolution order: a literal `apiKey` in the plugin config (discouraged —
secrets should not live in config files), then `TAVILY_API_KEY` in the launching
environment.

**2. Select the provider.** The base bundle pins `web.searchProvider` to
`deepseek-official`, and a configured id always wins — so add the override to the profile's
`cordis.patch.yml` (or the home-level `~/.dsh/cordis.patch.yml`):

```yaml
- id: web
  config:
    searchProvider: tavily
```

Restart dsh. To also retire the DeepSeek search plugin entirely:

```yaml
- id: web-search-deepseek
  disabled: true
```

**Plugin config** (all optional; via a patch layer, applied at startup):

| Field | Default | Notes |
|---|---|---|
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference resolved per search |
| `apiKey` | — | Literal key; wins over the reference |
| `baseURL` | `https://api.tavily.com` | Env override: `TAVILY_BASE_URL` |
| `searchDepth` | `basic` | `basic`/`advanced` (2 credits)/`fast`/`ultra-fast` |
| `topic` | `general` | `general`/`news`/`finance` |
| `maxResults` | `8` | Default when the tool sends no bound; API caps at 20 |
| `includeAnswer` | `true` | Surfaces Tavily's generated answer as the result's `content` |

## Behavior

- `results[].content` maps to the portable `snippet`; Tavily's `answer` maps to
  `content`; the API returns no publication dates, so `publishedAt` is never set.
- Cancellation (`WEB_ABORTED`), missing credentials (`WEB_PROVIDER_CREDENTIAL_MISSING`),
  and provider failures (`WEB_PROVIDER_ERROR`) follow the `ctx.web` seam contract; a
  rejected key is reported as `Tavily rejected the API key (HTTP 401)`.
- `available()` is a local check only (credential source present, base URL parseable).

## Develop

```sh
npm install
npm run check   # tsc --noEmit
npm test        # build + node --test
```

Local install without publishing: point the profile dependency at the checkout
(`"link:/path/to/dsh-web-search-tavily"`), `pnpm install`, restart dsh.

## License

MIT
