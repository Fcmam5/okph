#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  generateMermaid,
  getAffected,
  getDependencies,
  getDependents,
  inducedSubgraph,
  loadGraph,
  renderMermaid,
  resolveDocPath,
  subgraph,
} from "../src/index.js";

const DOC_COMMANDS = new Set(["deps", "dependents", "affected"]);

const USAGE = `okph - generate a Mermaid graph of a markdown knowledge base

Usage:
  okph graph <path> [--base-url <url>] [--allow-large]
  okph deps <file> [--graph]
  okph dependents <file> [--graph]
  okph affected <file> [--graph]

Options:
  --base-url <url>  Emit absolute click links joined onto <url>.
                    Omit for relative links (GitHub/GitLab rendered markdown).
  --allow-large     Bypass the 500 node/edge limit and render anyway.
  --graph           Render deps/dependents/affected as a Mermaid subgraph instead of a list.
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
      graph: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, target] = positionals;

  if (command !== "graph" && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(`Unknown or missing command: ${command ?? "(none)"}\n\n${USAGE}`);
    return 1;
  }
  if (!target) {
    process.stderr.write(`Missing <path>.\n\n${USAGE}`);
    return 1;
  }

  if (command && DOC_COMMANDS.has(command)) {
    const root = process.cwd();
    const rel = resolveDocPath(root, target);
    if (!rel || !rel.toLowerCase().endsWith(".md")) {
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

    const baseUrl = values["base-url"];
    const renderOpts = baseUrl ? { baseUrl } : {};

    if (command === "affected") {
      const affected = getAffected(graph, [rel]);
      if (values.graph) {
        process.stdout.write(renderMermaid(inducedSubgraph(graph, affected), renderOpts) + "\n");
      } else {
        process.stderr.write("Potentially affected documents:\n");
        process.stdout.write(affected.join("\n") + "\n");
      }
      return 0;
    }

    if (values.graph) {
      process.stdout.write(
        renderMermaid(subgraph(graph, rel, command as "deps" | "dependents"), renderOpts) + "\n"
      );
      return 0;
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
