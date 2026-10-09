# OKPH

[![CI](https://github.com/Fcmam5/okph/actions/workflows/main.yml/badge.svg)](https://github.com/Fcmam5/okph/actions/workflows/main.yml)
[![npm](https://img.shields.io/npm/v/@fcmam5/okph)](https://www.npmjs.com/package/@fcmam5/okph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Git-native graph and impact-analysis tool for OKF knowledge bases. Generates a clickable Mermaid graph from a folder of Markdown files (default output; other formats may follow).

## Install

```bash
npm i -g @fcmam5/okph
# or
pnpm i -g @fcmam5/okph
```

Or run it without installing — e.g. in a CI job to validate a bundle:

```bash
npx @fcmam5/okph validate ./docs --git origin/main
```

## CLI

```bash
okph graph ./docs
okph graph ./docs --base-url https://example.com/docs
okph graph ./docs --allow-large
okph deps docs/ledger.md        # files ledger.md links to
okph dependents docs/ledger.md  # files linking to ledger.md
okph deps docs/ledger.md --graph  # same, as a Mermaid subgraph
okph affected docs/ledger.md      # ledger.md + everything transitively linking to it
okph affected docs/ledger.md --graph
okph affected --git HEAD~1         # changed markdown since HEAD~1 + their dependents
okph affected --git main --graph
okph affected --git main --root docs  # only look at docs/, ignore the rest of the repo
okph affected --git main --root docs --md  # same, as a markdown link list
okph affected --git main --root docs --exclude '**/{index,log}.md'  # skip files entirely
okph validate ./docs                  # check the bundle against the OKF spec
okph validate ./docs --strict         # also fail on warnings (CI gate)
okph validate ./docs --git main       # all errors, but warnings only for docs changed since main
okph validate ./docs --strict --ignore prefer-absolute-links  # keep relative links, skip that warning
```

`validate` checks a bundle against the OKF spec and prints findings as `path -> target [level] kind: message`, sorted by path. Errors are spec MUSTs (missing or unparseable frontmatter, missing `type`, `index.md`/`log.md` misuse); warnings are spec SHOULDs and tolerated problems (broken links, missing files named by `resource`/`computation`/`executor`/`attester`, relative links, orphans, malformed `status`/`tags`/`generated`/`verified`, missing `description`). Exits `1` on any error — warnings pass unless `--strict` is set.

`validate --git <base>` is an opt-in speed-up for PR checks. It still scans the whole bundle and reports **every error**; only *warnings* are limited to markdown files changed or deleted since `<base>` and their dependents (links from `index.md`/`log.md` count here, so a broken listing entry is still reported). `orphan`, `recommended-index` and `okf-version-*` warnings are always kept, because a changed link can orphan a document that never changed. A summary line on stderr says how many docs were in scope. Git failures (unknown `<base>`, not a repository) exit non-zero rather than passing. It is not a substitute for a full `validate` run on your main branch.

`--ignore <kind>` suppresses a warning kind (repeatable); ignored findings are neither printed nor counted, so `--strict` skips them. Errors can't be ignored, and unknown kinds are rejected. Kinds: `escapes-bundle`, `invalid-generated`, `invalid-status`, `invalid-tags`, `invalid-verified`, `log-date-order`, `missing-doc`, `missing-file`, `missing-resource`, `missing-source-resource`, `okf-version-format`, `okf-version-unsupported`, `orphan`, `prefer-absolute-links`, `recommended-description`, `recommended-index`. The kind is the word after `[warning]` in the output. Example: if your bundle lives in `docs/` and your links are relative (`../concepts/x.md`) so they stay clickable in your editor, `--ignore prefer-absolute-links` stops the validator from warning about them. A `/`-prefixed link means "from the bundle root", but editors resolve it from the repo root, so it would break there.

`deps`/`dependents`/`affected` scan the knowledge base from the current working directory and print sorted paths, one per line — no Mermaid. Paths are relative to your cwd, so run from the repo root for repo-relative output. `affected` means *potentially* affected: reachable through links, not necessarily impacted. Links are read as citations — `a → b` means "a relies on b's content", so `affected b.md` reports `b.md` plus everything that cites it, transitively. `affected --git <base>` seeds from markdown files changed or deleted since `<base>` (commits, working tree, and untracked files), then reports those files plus their transitive dependents — useful for "what might need review after this branch" checks.

### Keeping repo files out of the graph

Run from a repo root and the scan picks up `README.md`, `CONTRIBUTING.md` and friends. If your README links into the knowledge base, it cites those documents and shows up in every `affected` result.

Use `--root <dir>` to scan only the knowledge base:

```bash
okph affected --git main --root docs
```

Files outside `<dir>` are not scanned and never appear in the output. You still write `<file>` and read results relative to where you are, so `--root docs` still prints `docs/ledger.md`.

### Index files

`index.md` and `log.md` are reserved files (spec §3.1): a listing enumerates documents and a log chronicles them — neither relies on them. So links *out of* them don't count as dependencies: they never get added as dependents, and `affected` doesn't propagate through them. Links *to* them still count, and naming one directly works — `deps index.md` lists its links, `dependents index.md` reports what links to it, `affected index.md` includes it as a seed. They're drawn dotted in `graph` output.

`--include-nav` turns that off. You shouldn't need it: spec §3.1 says reserved files can't be concept documents, so real content in one means the bundle is wrong.

In `--graph` output the queried document is drawn with a filled highlight so it stands out among the other nodes. For `affected --git`, every changed file included in the rendered graph is highlighted by status: green = added, amber = modified, red = deleted.

`graph` output is Mermaid graph syntax printed to stdout. Pipe it to a file or Mermaid renderer.

Note on scan scope: `graph <path>` recursively reads every `.md` file under `<path>` — including paths outside your cwd (e.g. `okph graph /some/dir`). `deps`/`dependents`/`affected` scan from the current working directory, or from `--root <dir>` when given.

Graphs over 500 nodes or edges fail by default, since many renderers (e.g. GitHub) truncate them. Pass `--allow-large` to render anyway.

## API

```ts
import { generateMermaid } from "@fcmam5/okph";

const graph = await generateMermaid("./docs", {
  baseUrl: "https://example.com/docs",
});
```

## Example

The example below was generated from the [`supachai-j/open-knowledge-format-starter`](https://github.com/supachai-j/open-knowledge-format-starter) OKF bundle using `--base-url`.

```mermaid
graph TD
  n_a48746ca["Subdirectories"]
  n_7204c0a4["Directory Update Log"]
  n_e5402305["Metrics"]
  n_c332fa58["Weekly Active Users (WAU)"]
  n_84209736["Incident Response (Sev1/Sev2)"]
  n_2ee90f39["Playbooks"]
  n_620ec17c["Subdirectories"]
  n_84ac5870["Joins"]
  n_c61967be["Orders → Customers join"]
  n_ea678391["Customers"]
  n_50516fd3["Tables"]
  n_17ec6115["Orders"]
  n_c61967be --> n_ea678391
  n_c61967be --> n_17ec6115
  click n_a48746ca "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/index.md"
  click n_7204c0a4 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/log.md"
  click n_e5402305 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/metrics/index.md"
  click n_c332fa58 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/metrics/weekly-active-users.md"
  click n_84209736 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/playbooks/incident-response.md"
  click n_2ee90f39 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/playbooks/index.md"
  click n_620ec17c "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/references/index.md"
  click n_84ac5870 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/references/joins/index.md"
  click n_c61967be "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/references/joins/orders__customers.md"
  click n_ea678391 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/tables/customers.md"
  click n_50516fd3 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/tables/index.md"
  click n_17ec6115 "https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki/tables/orders.md"
```

<details>
<summary>How this example was generated</summary>

```bash
git clone --depth 1 https://github.com/supachai-j/open-knowledge-format-starter.git /tmp/okf-starter
okph graph /tmp/okf-starter/wiki \
  --base-url https://github.com/supachai-j/open-knowledge-format-starter/blob/main/wiki
```

</details>

## Security & Privacy

- No network calls, no telemetry.
- No file writes unless explicitly requested.
- Output is sanitized: labels are escaped and click hrefs only allow `http(s)://` and relative paths.
- See [PRIVACY.md](./PRIVACY.md) for details.

## License

MIT