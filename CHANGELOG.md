# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-09-03

### Changed
- CI retires the alpha line: the dsh CLI is installed from the rolling rc/stable line — the newest of the `latest`/`next` dist-tags, resolved at runtime (never hand-pinned, never alpha)
- deps: peer floors move to `>=0.1.2-rc.1` and devDependencies pin `0.1.2-rc.1` exactly (cordis/schemastery unchanged)
- README announces RC/stable-only support: the alpha line is no longer supported
- **BREAKING — dsh host floor `>= 0.1.2-alpha.3`, rc-line support dropped**: all `@deepseek-ai` pins move to the 0.1.2-alpha.3 host closure (peers cordis ^4.0.2, schemastery ^3.18.2, dsh-web / dsh-credentials / dsh-launch-environment >=0.1.2-alpha.3; devDependencies exact). No source changes were needed — every import (`credentialRef`, `CredentialRef`, `WebError`, the `WebSearchProvider` surface) is unchanged in alpha.3, proven by typecheck against the closure.

### Added
- Boot smoke (`npm run smoke`, `scripts/smoke-boot.mjs`): mounts the packed plugin into a scratch dsh profile and boots it with the real dsh CLI; CI installs the host from the rolling rc/stable line (newest of the `latest`/`next` dist-tags), links the closure types, and gains a daily schedule

## [0.1.2] - 2026-08-29

### Changed
- npm metadata-only release: add keywords (dsh, dsh-plugin, deepseek-harness, web-search, search, tavily) for registry discoverability; no code changes
