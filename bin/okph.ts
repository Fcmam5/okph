#!/usr/bin/env node
import { parseArgs } from "node:util";
import { generateMermaid } from "../src/index.js";

const USAGE = `okph - generate a Mermaid graph of a markdown knowledge base

Usage:
  okph graph <path> [--base-url <url>]

Options:
  --base-url <url>  Emit absolute click links joined onto <url>.
                    Omit for relative links (GitHub/GitLab rendered markdown).
  -h, --help        Show this help.
`;

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, target] = positionals;

  if (command !== "graph") {
    process.stderr.write(`Unknown or missing command: ${command ?? "(none)"}\n\n${USAGE}`);
    return 1;
  }
  if (!target) {
    process.stderr.write(`Missing <path>.\n\n${USAGE}`);
    return 1;
  }

  const options = values["base-url"] ? { baseUrl: values["base-url"] } : {};
  const mermaid = await generateMermaid(target, options);
  process.stdout.write(mermaid + "\n");
  return 0;
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
