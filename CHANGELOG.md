# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **BREAKING — dsh host floor `>= 0.1.2-alpha.3`, rc-line support dropped**: all `@deepseek-ai` pins move to the 0.1.2-alpha.3 host closure (peers cordis ^4.0.2, schemastery ^3.18.2, dsh-web / dsh-credentials / dsh-launch-environment >=0.1.2-alpha.3; devDependencies exact). No source changes were needed — every import (`credentialRef`, `CredentialRef`, `WebError`, the `WebSearchProvider` surface) is unchanged in alpha.3, proven by typecheck against the closure.

### Added
- Boot smoke (`npm run smoke`, `scripts/smoke-boot.mjs`): mounts the packed plugin into a scratch dsh profile and boots it with the real dsh CLI; CI installs the host from the rolling `@alpha` dist-tag (latest still points at the dropped rc line), links the closure types, and gains a daily schedule

## [0.1.2] - 2026-08-29

### Changed
- npm metadata-only release: add keywords (dsh, dsh-plugin, deepseek-harness, web-search, search, tavily) for registry discoverability; no code changes
