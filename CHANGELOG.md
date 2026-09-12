# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-12

### Fixed

- Removed `devEngines`/`packageManager` from `package.json` — npm hard-failed on the pnpm requirement, blocking the release workflow. Publish step now uses `pnpm publish`. This release supersedes `0.1.0`, which never reached npm.

## [0.1.0] - 2026-09-12

### Added

- `okph graph <path>` — generate a Mermaid graph from a folder of Markdown files.
- `--base-url <url>` — emit absolute `click` links (e.g. GitHub blob URLs) instead of relative paths.
- `--allow-large` — render graphs exceeding 500 nodes/edges; the command fails by default above that limit.
- Library API: `generateMermaid(path, { baseUrl, allowLarge })`.
- Deterministic output: sorted nodes/edges and content-hashed node IDs.
- Sanitized output: labels are escaped and `click` hrefs are limited to `http(s)` URLs and relative paths.
