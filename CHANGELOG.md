# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `okph deps <file>` — list direct outgoing links of a document.
- `okph dependents <file>` — list documents that link to a document.
- Library API: `loadGraph`, `getDependencies`, `getDependents`, `neighborhood`, `toPosix`.
- `okph graph <file>` renders the file plus its direct dependencies and dependents.
- `okph affected <file>` — list a document plus all transitive dependents ("potentially affected"); `--graph` renders the affected subgraph.
- `okph affected --git <base>` — seed affected from markdown files changed since `<base>` (commits, working tree, and untracked files); deleted documents are reported on stderr; supports `--graph`.
- `--graph` flag on `deps`/`dependents` renders the result as a Mermaid subgraph.
- Library API: `subgraph`, `getAffected`, `inducedSubgraph`, `changedMarkdownFiles`.

### Fixed

- `click` hrefs now reject `"`, backticks, backslashes, and control characters (Mermaid directive injection via filenames).
- Bundle-relative links (`/docs/x.md`) resolve from the bundle root per OKF spec.
- Percent-encoded link targets (`my%20doc.md`) resolve to on-disk paths.
- Link fragments are preserved as `ParsedLink.fragment` metadata.
- Frontmatter is detected after a UTF-8 BOM.
- H1 titles are flattened to plain text (no raw markdown in labels).
- `deps`/`dependents` reject empty/out-of-root targets with a clear error.

## [0.1.1] - 2026-09-12

### Changed

- Package renamed to `@fcmam5/okph` — npm blocks the unscoped `okph` as too similar to `opn`. The `okph` CLI command is unchanged.

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
