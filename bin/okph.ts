#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
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
  safeHref,
  subgraph,
  terminalSafe,
  toPosix,
  validate,
  type Graph,
} from "../src/index.js";

const DOC_COMMANDS = new Set(["deps", "dependents", "affected"]);

/** `- [Title](path)` lines for `--md` output. */
function mdLines(
  graph: Graph,
  paths: readonly string[],
  display: (rel: string) => string,
  baseUrl?: string
): string[] {
  const labelOf = new Map(graph.nodes.map((n) => [n.path, n.label]));
  return paths.map((rel) => {
    const label = terminalSafe(labelOf.get(rel) ?? rel).replace(/[[\]]/g, "");
    const href = safeHref(display(rel), baseUrl);
    if (href === null) return `- ${label}`;
    // Angle-wrapped destinations are the CommonMark escape for parens in
    // filenames — encodeURIComponent leaves `()` alone.
    const dest = /[()]/.test(href) ? `<${href}>` : href;
    return `- [${label}](${dest})`;
  });
}

/** Print the affected set as a Mermaid subgraph, markdown list, or sorted path list. */
function emitAffected(
  graph: Graph,
  affected: string[],
  useGraph: boolean,
  renderOpts: { baseUrl?: string },
  display: (rel: string) => string,
  md: boolean
) {
  if (useGraph) {
    process.stdout.write(renderMermaid(inducedSubgraph(graph, affected), renderOpts) + "\n");
  } else {
    process.stderr.write("Potentially affected documents:\n");
    const lines = md
      ? mdLines(graph, affected, display, renderOpts.baseUrl)
      : affected.map((p) => terminalSafe(display(p)));
    process.stdout.write(lines.join("\n") + "\n");
  }
}

const USAGE = `okph - generate a Mermaid graph of a markdown knowledge base

Usage:
  okph graph <path> [--base-url <url>] [--allow-large]
  okph deps <file> [--root <dir>] [--graph] [--md] [--exclude <glob>...]
  okph dependents <file> [--root <dir>] [--graph] [--md] [--exclude <glob>...]
  okph affected <file> [--root <dir>] [--graph] [--md] [--exclude <glob>...]
  okph affected --git <base> [--root <dir>] [--graph] [--md] [--exclude <glob>...]
  okph validate [path] [--strict]

Options:
  --base-url <url>  Emit absolute links joined onto <url> (graph clicks and
                    --md links). Omit for relative links.
  --allow-large     Bypass the 500 node/edge limit and render anyway.
  --root <dir>      Scan <dir> instead of the current directory, so files
                    outside it (a repo README, CONTRIBUTING, .github/) are
                    not part of the graph. <file> is still written relative
                    to where you are, and results are printed that way too.
  --graph           Render deps/dependents/affected as a Mermaid subgraph instead of a list.
  --md              Print deps/dependents/affected as a markdown link list (\`- [Title](path)\`).
  --exclude <glob>  Drop matching files from the graph (repeatable, matched
                    against root-relative, /-separated paths).
                    E.g. '**/{index,log}.md'.
  --include-nav     Count index.md/log.md links as dependencies in dependents
                    and affected. Off by default (OKF §3.1); deps always
                    lists every link.
  --git <base>      Seed affected from markdown files changed or deleted
                    since <base> (commits, working tree, and untracked files).
                    <base> may be any revision or range, e.g. HEAD~1, main..HEAD.
  --strict          validate: exit non-zero on warnings too (CI gate).
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
      "include-nav": { type: "boolean" },
      md: { type: "boolean" },
      exclude: { type: "string", multiple: true },
      root: { type: "string" },
      strict: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, target] = positionals;

  if (command !== "graph" && command !== "validate" && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(
      `Unknown or missing command: ${command === undefined ? "(none)" : terminalSafe(command)}\n\n${USAGE}`
    );
    return 1;
  }
  if (values["include-nav"] && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(
      `Error: --include-nav is only supported by the deps, dependents, and affected commands.\n\n${USAGE}`
    );
    return 1;
  }
  if (values.md && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(
      `Error: --md is only supported by the deps, dependents, and affected commands.\n\n${USAGE}`
    );
    return 1;
  }
  if (values.exclude !== undefined && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(
      `Error: --exclude is only supported by the deps, dependents, and affected commands.\n\n${USAGE}`
    );
    return 1;
  }
  const exclude = values.exclude ?? [];
  // Glob compilation can blow up exponentially on pathological patterns
  // (e.g. long runs of braces); paths can't exceed 255 bytes anyway.
  if (exclude.some((g) => g.length > 256)) {
    process.stderr.write(`Error: --exclude glob exceeds 256 characters.\n\n${USAGE}`);
    return 1;
  }
  if (values.root !== undefined && !DOC_COMMANDS.has(command ?? "")) {
    process.stderr.write(
      `Error: --root is only supported by the deps, dependents, and affected commands. Pass the directory to graph instead.\n\n${USAGE}`
    );
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
    const root = values.root === undefined ? cwd : path.resolve(cwd, values.root);
    if (values.root !== undefined) {
      const problem = await rootError(root, values.root);
      if (problem) {
        process.stderr.write(problem);
        return 1;
      }
    }
    const baseUrl = values["base-url"];
    const renderOpts = baseUrl ? { baseUrl } : {};
    const walkOpts = { includeNav: values["include-nav"] === true };
    // Paths are root-relative inside the graph, but echoed back the way the
    // user types them: relative to the directory they are standing in.
    const display = (rel: string) => toPosix(path.relative(cwd, path.join(root, rel)));

    if (command === "affected" && values.git !== undefined) {
      const { changed, deleted } = await changedMarkdownFiles(values.git, root);
      // Deleted docs are kept as stub nodes (unless excluded) so edges
      // pointing at them survive and their dependents show up as affected.
      const graph = await loadGraph(root, { extraPaths: deleted, exclude });
      if (deleted.length > 0) {
        process.stderr.write(
          `Deleted since ${terminalSafe(values.git)}: ${deleted.map((p) => terminalSafe(display(p))).join(", ")}\n`
        );
      }
      const known = new Set(graph.nodes.map((n) => n.path));
      const seeds = [...changed, ...deleted].filter((s) => known.has(s));
      if (seeds.length === 0) {
        process.stderr.write(
          `No markdown files changed since ${terminalSafe(values.git)} (or all were excluded).\n`
        );
        return 0;
      }
      emitAffected(
        graph,
        getAffected(graph, seeds, walkOpts),
        values.graph === true,
        renderOpts,
        display,
        values.md === true
      );
      return 0;
    }

    if (!target) {
      process.stderr.write(`Missing <path>.\n\n${USAGE}`);
      return 1;
    }
    const rel = resolveDocPath(root, target, cwd);
    if (!rel || !rel.toLowerCase().endsWith(".md")) {
      const scope = values.root === undefined ? "the working directory" : terminalSafe(values.root);
      process.stderr.write(
        `Error: ${terminalSafe(target)} is not a markdown file inside ${scope}.\n`
      );
      return 1;
    }
    const graph = await loadGraph(root, { exclude });
    if (!graph.nodes.some((n) => n.path === rel)) {
      process.stderr.write(`Error: not a known document: ${terminalSafe(display(rel))}\n`);
      return 1;
    }

    if (command === "affected") {
      emitAffected(
        graph,
        getAffected(graph, [rel], walkOpts),
        values.graph === true,
        renderOpts,
        display,
        values.md === true
      );
      return 0;
    }

    if (values.graph) {
      process.stdout.write(
        renderMermaid(
          subgraph(graph, rel, command === "deps" ? "deps" : "dependents", walkOpts),
          renderOpts
        ) + "\n"
      );
      return 0;
    }
    const result =
      command === "deps" ? getDependencies(graph, rel) : getDependents(graph, rel, walkOpts);
    if (result.length > 0) {
      const lines = values.md === true
        ? mdLines(graph, result, display, renderOpts.baseUrl)
        : result.map((p) => terminalSafe(display(p)));
      process.stdout.write(lines.join("\n") + "\n");
    }
    return 0;
  }

  if (command === "validate") {
    const root = path.resolve(cwd, target ?? ".");
    const problem = await rootError(root, target ?? ".", "path");
    if (problem) {
      process.stderr.write(problem);
      return 1;
    }
    const { diagnostics, version, errorCount, warningCount } = await validate(root);
    for (const d of diagnostics) {
      const where = d.target === undefined ? d.path : `${d.path} -> ${d.target}`;
      process.stdout.write(`${terminalSafe(where)}  [${d.level}] ${d.kind}: ${d.message}\n`);
    }
    if (diagnostics.length === 0) {
      process.stderr.write(`OKF ${version}: no problems found.\n`);
    } else {
      process.stderr.write(
        `OKF ${version}: ${errorCount} error(s), ${warningCount} warning(s).\n`
      );
    }
    if (errorCount > 0) return 1;
    return values.strict === true && warningCount > 0 ? 1 : 0;
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

/**
 * Check a user-supplied directory, returning an error line or `null`.
 * A missing path and an unreadable one are reported differently, so a
 * permissions or I/O failure is not mistaken for a typo.
 */
async function rootError(
  resolved: string,
  asTyped: string,
  label: string = "--root"
): Promise<string | null> {
  const shown = terminalSafe(asTyped);
  try {
    if ((await stat(resolved)).isDirectory()) return null;
    return `Error: ${label} is not a directory: ${shown}\n`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return `Error: ${label} does not exist: ${shown}\n`;
    return `Error: cannot read ${label} ${shown}: ${code ?? "unknown error"}\n`;
  }
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
