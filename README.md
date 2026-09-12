# OKPH

Git-native graph and impact-analysis tool for OKF knowledge bases. Generates a clickable Mermaid graph from a folder of Markdown files (default output; other formats may follow).

## Install

```bash
npm i -g @fcmam5/okph
# or
pnpm i -g @fcmam5/okph
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
```

`deps`/`dependents`/`affected` scan the knowledge base from the current working directory and print sorted paths, one per line — no Mermaid. Paths are relative to your cwd, so run from the repo root for repo-relative output. `affected` means *potentially* affected: reachable through links, not necessarily impacted. Links are read as citations — `a → b` means "a relies on b's content", so `affected b.md` reports `b.md` plus everything that cites it, transitively.

`graph` output is Mermaid graph syntax printed to stdout. Pipe it to a file or Mermaid renderer.

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