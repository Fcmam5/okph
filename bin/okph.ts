#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import {
  generateMermaid,
  getDependencies,
  getDependents,
  loadGraph,
  toPosix,
} from "../src/index.js";

const USAGE = `okph - generate a Mermaid graph of a markdown knowledge base

Usage:
  okph graph <path> [--base-url <url>] [--allow-large]
  okph deps <file>
  okph dependents <file>

Options:
  --base-url <url>  Emit absolute click links joined onto <url>.
                    Omit for relative links (GitHub/GitLab rendered markdown).
  --allow-large     Bypass the 500 node/edge limit and render anyway.
  -h, --help        Show this help.
`;

/**
 * Handle one CLI invocation, writing results or usage errors to standard streams.
 * Returns `0` on success and `1` for invalid commands, targets, or documents.
 * Argument-parsing, filesystem, and graph-rendering errors propagate to the caller.
 */
export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      "allow-large": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, target] = positionals;

  if (command !== "graph" && command !== "deps" && command !== "dependents") {
    process.stderr.write(`Unknown or missing command: ${command ?? "(none)"}\n\n${USAGE}`);
    return 1;
  }
  if (!target) {
    process.stderr.write(`Missing <path>.\n\n${USAGE}`);
    return 1;
  }

  if (command === "deps" || command === "dependents") {
    const root = process.cwd();
    const rel = toPosix(path.relative(root, path.resolve(target)));
    if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
      process.stderr.write(
        `Error: ${target} is not a markdown file inside the working directory.\n`
      );
      return 1;
    }
    const graph = await loadGraph(root);
    if (!graph.nodes.some((n) => n.path === rel)) {
      process.stderr.write(`Error: not a known document: ${rel}\n`);
      return 1;
    }
    const result =
      command === "deps" ? getDependencies(graph, rel) : getDependents(graph, rel);
    if (result.length > 0) process.stdout.write(result.join("\n") + "\n");
    return 0;
  }

  const options: { baseUrl?: string; allowLarge?: boolean } = {};
  if (values["base-url"]) options.baseUrl = values["base-url"];
  if (values["allow-large"]) options.allowLarge = true;
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
