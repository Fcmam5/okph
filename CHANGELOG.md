# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-13

### Added

- `okph deps <file>` — list direct outgoing links of a document.
- `okph dependents <file>` — list documents that link to a document.
- Library API: `loadGraph`, `getDependencies`, `getDependents`, `neighborhood`, `toPosix`.
- `okph graph <file>` renders the file plus its direct dependencies and dependents.
- `okph affected <file>` — list a document plus all transitive dependents ("potentially affected"); `--graph` renders the affected subgraph.
- `okph affected --git <base>` — seed affected from markdown files changed or deleted since `<base>` (commits, working tree, and untracked files); deleted documents are reported on stderr and kept as stub nodes so their dependents are still found; supports `--graph`.
- `--graph` flag on `deps`/`dependents` renders the result as a Mermaid subgraph.
- Library API: `subgraph`, `getAffected`, `inducedSubgraph`, `changedMarkdownFiles`.
- Library API: `loadGraph(root, { extraPaths })`, `terminalSafe`.
- Per-file size limit (`MAX_DOC_BYTES`, 5 MiB) when loading documents.

### Fixed

- `click` hrefs now reject `"`, backticks, backslashes, and control characters (Mermaid directive injection via filenames).
- Bundle-relative links (`/docs/x.md`) resolve from the bundle root per OKF spec.
- Percent-encoded link targets (`my%20doc.md`) resolve to on-disk paths.
- Link fragments are preserved as `ParsedLink.fragment` metadata.
- Frontmatter is detected after a UTF-8 BOM.
- H1 titles are flattened to plain text (no raw markdown in labels).
- `deps`/`dependents` reject empty/out-of-root targets with a clear error.
- Git root detection preserves trailing whitespace in repository paths.

### Security

- Mermaid labels now escape `#`, `&`, `\`, `<`, `>` in addition to quotes and brackets — HTML/entity injection into labels is neutralized for renderers that allow HTML.
- `click` hrefs percent-encode each path segment: filenames containing `%`, `#`, `?`, spaces, or encoded `..` sequences can no longer escape the base URL or the site root.
- Absolute `click` URLs must be `http(s)://`; a bare `scheme:` filename (e.g. `https:evil.com.md`) is rejected instead of resolving cross-origin.
- Filenames containing control or bidirectional-override characters are JSON-quoted in CLI output (terminal/CI-log injection via crafted filenames).

## [0.1.2] - 2026-09-12

### Changed

- First version published to npm, as `@fcmam5/okph`. Install/API docs updated to the scoped name; release workflow environment URL corrected. Content is identical to 0.1.1 — see below.

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
