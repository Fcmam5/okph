#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { injectGraph, writeFileAtomic } from "../src/readme.js";
import {
  MAX_DOC_BYTES,
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
  WARNING_KINDS,
  type Graph,
  type RenderOptions,
  type WarningKind,
} from "../src/index.js";

const DOC_COMMANDS = new Set(["deps", "dependents", "affected"]);
const KNOWN_COMMANDS = new Set([...DOC_COMMANDS, "graph", "validate", "readme"]);

/** Quote `arg` for a POSIX shell when it has anything but plain path characters. */
const shellArg = (arg: string) =>
  /^[\w./@:+=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;

/** `- [Title](path)` lines for `--md` output. */
function mdLines(
  graph: Graph,
  paths: readonly string[],
  display: (rel: string) => string,
  baseUrl?: string
): string[] {
  const labelOf = new Map(graph.nodes.map((n) => [n.path, n.label]));
  return paths.map((rel) => {
    const label = terminalSafe(labelOf.get(rel) ?? rel)
      .replace(/[[\]]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const href = safeHref(display(rel), baseUrl);
    if (href === null) return `- ${label}`;
    // Angle-wrapped destinations are the CommonMark escape for parens in
    // filenames — encodeURIComponent leaves `()` alone.
    const dest = /[()]/.test(href) ? `<${href}>` : href;
    return `- [${label}](${dest})`;
  });
}

/**
 * Graph of `root` plus the changed docs that exist in it as seeds. Deleted
 * docs are kept as stub nodes (unless excluded) so edges pointing at them
 * survive and their dependents show up as affected.
 */
async function seedGraph(
  root: string,
  changed: Awaited<ReturnType<typeof changedMarkdownFiles>>,
  exclude: string[] = []
): Promise<{ graph: Graph; seeds: string[] }> {
  const graph = await loadGraph(root, { extraPaths: changed.deleted, exclude });
  const known = new Set(graph.nodes.map((n) => n.path));
  const seeds = [...changed.added, ...changed.modified, ...changed.deleted].filter((s) =>
    known.has(s)
  );
  return { graph, seeds };
}

/** Print the affected set as a Mermaid subgraph, markdown list, or sorted path list. */
function emitAffected(
  graph: Graph,
  affected: string[],
  useGraph: boolean,
  renderOpts: RenderOptions,
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
  okph validate [path] [--git <base>] [--strict] [--ignore <kind>...]
  okph readme <file.md> [--root <dir>] [--base-url <url>] [--allow-large] [--write | --check]

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
                    With validate: the whole bundle is still scanned and every
                    error is reported, but warnings are limited to changed
                    docs and their dependents (orphans, index and version
                    warnings are always kept). Not a substitute for a full run.
  --strict          validate: exit non-zero on warnings too (CI gate).
  --ignore <kind>   validate: suppress a warning kind (repeatable). Ignored
                    findings are not printed or counted. Errors can't be ignored.
                    E.g. --ignore prefer-absolute-links.
                    Kinds: ${WARNING_KINDS.join(", ")}.
  --write           readme: rewrite <file.md> in place. Without it, the updated
                    file is printed to stdout and nothing on disk changes.
  --check           readme: exit non-zero if the generated block is stale (CI gate).
                    The block sits between <!-- okph:start --> and <!-- okph:end -->
                    marker lines; <file.md>'s directory is scanned unless --root is given.
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
      ignore: { type: "string", multiple: true },
      root: { type: "string" },
      strict: { type: "boolean" },
      write: { type: "boolean" },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, target] = positionals;

  if (!KNOWN_COMMANDS.has(command ?? "")) {
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
  const ignore = values.ignore ?? [];
  if (ignore.length > 0 && command !== "validate") {
    process.stderr.write(`Error: --ignore is only supported by the validate command.\n\n${USAGE}`);
    return 1;
  }
  const badKind = ignore.find((k) => !(WARNING_KINDS as readonly string[]).includes(k));
  if (badKind !== undefined) {
    const shown = badKind.length > 64 ? `${badKind.slice(0, 64)}…` : badKind;
    process.stderr.write(
      `Error: --ignore: '${terminalSafe(shown)}' is not an ignorable warning kind (errors can't be ignored). Use one of: ${WARNING_KINDS.join(", ")}.\n`
    );
    return 1;
  }
  if (values.root !== undefined && !DOC_COMMANDS.has(command ?? "") && command !== "readme") {
    process.stderr.write(
      `Error: --root is only supported by the deps, dependents, and affected commands. Pass the directory to graph instead.\n\n${USAGE}`
    );
    return 1;
  }
  for (const flag of ["write", "check"] as const) {
    if (values[flag] && command !== "readme") {
      process.stderr.write(`Error: --${flag} is only supported by the readme command.\n\n${USAGE}`);
      return 1;
    }
  }
  if (values.write && values.check) {
    process.stderr.write(`Error: --write and --check cannot be combined.\n\n${USAGE}`);
    return 1;
  }
  const gitMode = command === "affected" && values.git !== undefined;
  if (values.git !== undefined && !gitMode && command !== "validate") {
    process.stderr.write(
      `Error: --git is only supported by the affected and validate commands.\n\n${USAGE}`
    );
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
      const changed = await changedMarkdownFiles(values.git, root);
      const { added, modified, deleted } = changed;
      const { graph, seeds } = await seedGraph(root, changed, exclude);
      if (deleted.length > 0) {
        process.stderr.write(
          `Deleted since ${terminalSafe(values.git)}: ${deleted.map((p) => terminalSafe(display(p))).join(", ")}\n`
        );
      }
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
        { ...renderOpts, highlight: modified, added, deleted },
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
        { ...renderOpts, highlight: [rel] },
        display,
        values.md === true
      );
      return 0;
    }

    if (values.graph) {
      process.stdout.write(
        renderMermaid(
          subgraph(graph, rel, command === "deps" ? "deps" : "dependents", walkOpts),
          { ...renderOpts, highlight: [rel] }
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
    let scope: string[] | undefined;
    if (values.git !== undefined) {
      const changed = await changedMarkdownFiles(values.git, root);
      try {
        const { graph, seeds } = await seedGraph(root, changed);
        // includeNav: a broken link in index.md/log.md is still a finding.
        scope = seeds.length > 0 ? getAffected(graph, seeds, { includeNav: true }) : [];
      } catch (err) {
        process.stderr.write(
          `Could not scope to changed docs (${terminalSafe(err instanceof Error ? err.message : String(err))}); validating the whole bundle.\n`
        );
      }
    }
    const { diagnostics, version, errorCount, warningCount, docCount, scopedCount } =
      await validate(root, { ignore: ignore as WarningKind[], ...(scope && { scope }) });
    for (const d of diagnostics) {
      const where = d.target === undefined ? d.path : `${d.path} -> ${d.target}`;
      process.stdout.write(`${terminalSafe(where)}  [${d.level}] ${d.kind}: ${d.message}\n`);
    }
    if (scopedCount !== undefined) {
      process.stderr.write(
        `Scoped to ${scopedCount} of ${docCount} docs (warnings only; errors cover the whole bundle).\n`
      );
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

  if (command === "readme") {
    const file = path.resolve(cwd, target);
    const shown = terminalSafe(target);
    if (!file.toLowerCase().endsWith(".md")) {
      process.stderr.write(`Error: ${shown} is not a markdown file.\n`);
      return 1;
    }
    let info;
    try {
      info = await lstat(file);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      process.stderr.write(
        code === "ENOENT"
          ? `Error: ${shown} does not exist.\n`
          : `Error: cannot read ${shown}: ${code ?? "unknown error"}\n`
      );
      return 1;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      process.stderr.write(`Error: ${shown} must be a regular file (a symlink is not followed).\n`);
      return 1;
    }
    if (info.size > MAX_DOC_BYTES) {
      process.stderr.write(`Error: ${shown} exceeds the ${MAX_DOC_BYTES} byte limit.\n`);
      return 1;
    }
    const root = values.root === undefined ? path.dirname(file) : path.resolve(cwd, values.root);
    if (values.root !== undefined) {
      const problem = await rootError(root, values.root);
      if (problem) {
        process.stderr.write(problem);
        return 1;
      }
    }
    const content = await readFile(file, "utf8");
    const updated = injectGraph(content, await generateMermaid(root, options));
    if (values.check) {
      if (updated === content) {
        process.stderr.write(`${shown} is up to date.\n`);
        return 0;
      }
      process.stderr.write(
        `${shown} is stale. Run: okph readme ${terminalSafe(shellArg(target))} --write\n`
      );
      return 1;
    }
    if (!values.write) {
      process.stdout.write(updated);
      return 0;
    }
    if (updated === content) {
      process.stderr.write(`${shown} is already up to date.\n`);
      return 0;
    }
    await writeFileAtomic(file, updated, info.mode & 0o777);
    process.stderr.write(`Updated ${shown}.\n`);
    return 0;
  }
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

/**
 * The stderr line for an error that escaped `run`. Messages can carry hostile
 * paths (fs errors) or git's echo of a CLI argument, so they are sanitized.
 */
export function errorLine(err: unknown): string {
  return `Error: ${terminalSafe(err instanceof Error ? err.message : String(err))}\n`;
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
      process.stderr.write(errorLine(err));
      process.exitCode = 1;
    });
}
