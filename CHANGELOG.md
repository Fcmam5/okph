# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `okph readme <file.md>` — inject a generated Mermaid graph between `<!-- okph:start -->` / `<!-- okph:end -->` marker lines. Prints the updated file by default; `--write` rewrites it in place (atomic, symlinks refused); `--check` exits `1` when the block is stale. Supports `--root`, `--base-url`, `--allow-large`. Missing or malformed markers are an error and change nothing.

### Security

- Frontmatter parsing no longer lets the `yaml` library print warnings to stderr. For an unknown tag (e.g. `x: !foo ...`) it echoed the raw source line, so control characters in a document reached the terminal or CI log unsanitized.
- Errors that escape a command (filesystem errors naming a hostile path, git's echo of a CLI argument) now pass through `terminalSafe` before being printed.
- `validate` no longer follows symlinks out of the bundle when checking that linked files and `resource`-style paths exist. A link through a symlink to an outside directory now reads as missing whether or not the target exists, so a hostile bundle can't probe the filesystem. Symlinks that stay inside the bundle still resolve.
- `--git` now runs git with `core.fsmonitor` disabled (and `--no-ext-diff`). A repository's own config could otherwise make `affected --git` / `validate --git` execute an arbitrary command.
- `--md` output escapes `&`, `<` and `>` in document titles, so a title can't inject raw HTML into the generated markdown.
- Options (`ignore`, `scope`, `exclude`, `extraPaths`, `baseUrl`, `includeNav`, ...) and frontmatter fields are no longer read through the prototype chain. A polluted `Object.prototype` elsewhere in a host process could previously hide validation errors (`type`), widen or narrow scope, or redirect Mermaid click links to another origin (`baseUrl`) for library users.
- Reading a bundle now opens at most 32 files at once instead of all of them at once, avoiding file-descriptor exhaustion on large bundles.

### Added

- `validate --git <base>` — opt-in scoping for PR checks. The whole bundle is still scanned and every error is reported; warnings are limited to documents changed or deleted since `<base>` and their dependents (`orphan`, `recommended-index` and `okf-version-*` are always kept). Links from `index.md`/`log.md` count when computing dependents. Prints a `Scoped to N of M docs` line on stderr, fails on git errors, and falls back to validating the whole bundle if scoping fails (e.g. an oversized file). Library: `validate(root, { scope })`, and `ValidateResult` gains `docCount` and `scopedCount`.

### Changed

- The error for `--git` on unsupported commands now reads "only supported by the affected and validate commands".

## [0.8.0] - 2026-10-08

### Added

- `--ignore <kind>` on `validate` — suppress a warning kind (repeatable), e.g. `--ignore prefer-absolute-links` for bundles that keep relative links so they stay clickable in IDEs. Ignored findings are not printed or counted, so `--strict` skips them. Only warning kinds are accepted; unknown kinds and errors are rejected. Library: `validate(root, { ignore })`, plus exported `WARNING_KINDS`, `WarningKind`, and `ValidateOptions`.

## [0.7.0] - 2026-09-22

### Added

- `affected --git --graph` highlights changed seeds by status — green for added, amber for modified, red for deleted — instead of one color for all. Exposed as `RenderOptions.added`/`deleted` (with `highlight` kept for modified/queried) for library users.

### Changed

- **Breaking (library):** `changedMarkdownFiles` now returns `{ added, modified, deleted }` instead of `{ changed, deleted }` — `added` covers committed additions and untracked files, `modified` covers content changes. Renames are resolved with `--no-renames`, so they surface as delete (old path) + add (new path) regardless of the caller's `diff.renames` git config.

## [0.6.0] - 2026-09-22

### Added

- `--graph` output on `deps`/`dependents`/`affected` now highlights the queried document (or, for `affected --git`, every changed/deleted seed) with a filled style, so it stands out among its dependencies. Also exposed as `RenderOptions.highlight` for library users.

## [0.5.0] - 2026-09-22

### Added

- `--exclude <glob>` on `deps`/`dependents`/`affected` — drop matching files from the graph entirely (no node, no edges, not a seed). Repeatable; matched against root-relative paths. E.g. `--exclude '**/{index,log}.md'` keeps reserved files out of `affected` results even when they changed.

## [0.4.0] - 2026-09-19

### Changed

- `GraphEdge.kind` and the `EdgeKind` type are gone — breaking. Whether a link is a dependency is now decided from the filename at traversal time, via `isReservedFile()`. Same rule, one more file: `log.md` mentions no longer count as dependencies either. `--include-nav` covers both.

### Added

- `--md` on `deps`/`dependents`/`affected` — print results as a markdown link list (`- [Title](path)`) instead of plain paths; honors `--base-url` for absolute links.
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
