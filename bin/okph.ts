#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  changedMarkdownFiles,
  generateMermaid,
  getAffected,
  getDependencies,
  getDependents,
  inducedSubgraph,
  loadGraph,
  renderMermaid,
  resolveDocPath,
  subgraph,
  terminalSafe,
  type Graph,
} from "../src/index.js";

const DOC_COMMANDS = new Set(["deps", "dependents", "affected"]);

/** Print the affected set as a Mermaid subgraph or a sorted path list. */
function emitAffected(graph: Graph, affected: string[], useGraph: boolean, renderOpts: { baseUrl?: string }) {
  if (useGraph) {
    process.stdout.write(renderMermaid(inducedSubgraph(graph, affected), renderOpts) + "\n");
  } else {
    process.stderr.write("Potentially affected documents:\n");
    process.stdout.write(affected.map(terminalSafe).join("\n") + "\n");
  }
}

const USAGE = `okph - generate a Mermaid graph of a markdown knowledge base

Usage:
  okph graph <path> [--base-url <url>] [--allow-large]
  okph deps <file> [--graph]
  okph dependents <file> [--graph]
  okph affected <file> [--graph]
  okph affected --git <base> [--graph]

Options:
  --base-url <url>  Emit absolute click links joined onto <url>.
                    Omit for relative links (GitHub/GitLab rendered markdown).
  --allow-large     Bypass the 500 node/edge limit and render anyway.
  --graph           Render deps/dependents/affected as a Mermaid subgraph instead of a list.
  --git <base>      Seed affected from markdown files changed or deleted
                    since <base> (commits, working tree, and untracked files).
                    <base> may be any revision or range, e.g. HEAD~1, main..HEAD.
  -h, --help        Show this help.
`;

/**
 * Handle one CLI invocation, writing results or usage errors to standard streams.
 * Returns `0` on success and `1` for invalid commands, targets, or documents.
 * Argument-parsing, filesystem, and graph-rendering errors propagate to the caller.
 */
export async function run(argv: string[], cwd: string = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      "allow-large": { type: "boolean" },
      git: { type: "string" },
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
  const gitMode = command === "affected" && values.git !== undefined;
  if (values.git !== undefined && !gitMode) {
    process.stderr.write(`Error: --git is only supported by the affected command.\n\n${USAGE}`);
    return 1;
  }
  if (gitMode && target) {
    process.stderr.write(`Error: affected accepts either <file> or --git, not both.\n\n${USAGE}`);
    return 1;
  }

  if (command && DOC_COMMANDS.has(command)) {
    const root = cwd;
    const baseUrl = values["base-url"];
    const renderOpts = baseUrl ? { baseUrl } : {};

    if (command === "affected" && values.git !== undefined) {
      const { changed, deleted } = await changedMarkdownFiles(values.git, root);
      // Deleted docs are kept as stub nodes so edges pointing at them survive
      // and their dependents show up as affected.
      const graph = await loadGraph(root, { extraPaths: deleted });
      if (deleted.length > 0) {
        process.stderr.write(
          `Deleted since ${terminalSafe(values.git)}: ${deleted.map(terminalSafe).join(", ")}\n`
        );
      }
      const seeds = [...changed, ...deleted];
      if (seeds.length === 0) {
        process.stderr.write(`No markdown files changed since ${terminalSafe(values.git)}.\n`);
        return 0;
      }
      emitAffected(graph, getAffected(graph, seeds), values.graph === true, renderOpts);
      return 0;
    }

    if (!target) {
      process.stderr.write(`Missing <path>.\n\n${USAGE}`);
      return 1;
    }
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

    if (command === "affected") {
      emitAffected(graph, getAffected(graph, [rel]), values.graph === true, renderOpts);
      return 0;
    }

    if (values.graph) {
      process.stdout.write(
        renderMermaid(subgraph(graph, rel, command === "deps" ? "deps" : "dependents"), renderOpts) + "\n"
      );
      return 0;
    }
    const result =
      command === "deps" ? getDependencies(graph, rel) : getDependents(graph, rel);
    if (result.length > 0) process.stdout.write(result.join("\n") + "\n");
    return 0;
  }

  if (!target) {
    process.stderr.write(`Missing <path>.\n\n${USAGE}`);
    return 1;
  }
  const options: { baseUrl?: string; allowLarge?: boolean } = {};
  if (values["base-url"]) options.baseUrl = values["base-url"];
  if (values["allow-large"]) options.allowLarge = true;
  const mermaid = await generateMermaid(path.resolve(cwd, target), options);

  process.stdout.write(mermaid + "\n");
  return 0;
}

/** True when this file is the process entrypoint (not an import). */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
