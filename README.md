# OKPH

Git-native graph and impact-analysis tool for OKF knowledge bases. v0.1.0 generates a clickable Mermaid graph from a folder of Markdown files (default output; other formats may follow).

## Install

```bash
npm i -g okph
# or
pnpm i -g okph
```

## CLI

```bash
okph graph ./docs
okph graph ./docs --base-url https://example.com/docs
```

Output is Mermaid graph syntax printed to stdout by default. Pipe it to a file or Mermaid renderer.

## API

```ts
import { generateMermaid } from "okph";

const graph = await generateMermaid("./docs", {
  baseUrl: "https://example.com/docs",
});
```

## Security

- No network calls.
- No file writes unless explicitly requested.
- Output is sanitized: labels are escaped and click hrefs only allow `http(s)://` and relative paths.

## Privacy

No telemetry, no network calls. See [PRIVACY.md](./PRIVACY.md).

## License

MIT