# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `GraphEdge.kind` and the `EdgeKind` type are gone — breaking. Whether a link is a dependency is now decided from the filename at traversal time, via `isReservedFile()`. Same rule, one more file: `log.md` mentions no longer count as dependencies either. `--include-nav` covers both.
- `validate` now warns on more §5/§6.2 issues: bad `status` values, `tags` that aren't a string list, `generated` without `by`, malformed `verified` entries, and frontmatter paths (`resource`, `computation`, `executor`, `attester`, `sources`) pointing at files that don't exist.

### Added

- `okph validate [path]` and `validate(root)` — check a bundle against the OKF spec. Errors are conformance MUSTs (§11): missing/unparseable frontmatter, missing `type`, `index.md`/`log.md` misuse. Warnings cover SHOULDs and tolerated issues: broken links, frontmatter paths to missing files (`resource`, `computation`, `executor`, `attester`, `sources`), relative links, escaping links, orphans, malformed `status`/`tags`/`generated`/`verified`, missing `description`, missing root `index.md`. `--strict` fails on warnings too. Reads `okf_version` from the root index and warns on unsupported versions (best-effort, spec §12).

## [0.3.0] - 2026-09-18

### Added

- `--root <dir>` on `deps`/`dependents`/`affected` — scan only that directory. Use it to keep repo files like `README.md` and `CONTRIBUTING.md` out of the graph when you run from a repo root. You still type `<file>` and read results relative to where you are.
- `--include-nav` on `deps`/`dependents`/`affected` — count `index.md` links as dependencies again. Shouldn't be needed; spec §3.1 says an index isn't a concept document.

### Changed

- Links out of an `index.md` no longer count as dependencies. An OKF index file is a directory listing (spec §8) and may be generated automatically, so listing a document is not relying on it. An index is no longer reported as a dependent and no longer shows up in `affected`. It is still drawn in `graph`, now with a dotted arrow, and `deps index.md` still lists what it points at.
- `GraphEdge` has a new `kind` field, `"cite"` or `"nav"`. Breaking if you build edges by hand.

### Fixed

- Links inside list items and table cells were skipped. Only links in paragraphs and headings became edges, so an `index.md` — which is nothing but a list of links — produced no edges at all. Expect more edges than before, and more results from `dependents` and `affected`.

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
