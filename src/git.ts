import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { toPosix } from "./discover.js";

const execFileAsync = promisify(execFile);

/**
 * Run git with repository-configured command hooks disabled. Git reads the
 * scanned repo's own config, and `core.fsmonitor` names a command it runs on
 * `diff`/`ls-files`; that must never be a way to execute code through okph.
 */
const runGit = (args: string[], cwd: string) =>
  execFileAsync("git", ["-c", "core.fsmonitor=false", ...args], { cwd });

/** Markdown files changed relative to a git base revision. */
export interface ChangedFiles {
  /** Added `.md` files (committed additions and untracked), sorted, POSIX-style, relative to `cwd`. */
  readonly added: string[];
  /** Modified `.md` files, sorted, POSIX-style, relative to `cwd`. */
  readonly modified: string[];
  /** Deleted `.md` files, sorted, POSIX-style, relative to `cwd`. */
  readonly deleted: string[];
}

/**
 * List `.md` files changed relative to `base` (`git diff --name-only -z
 * <base> --` plus `git ls-files --others --exclude-standard -z`), so the
 * result covers commits, the working tree, and untracked files.
 *
 * Paths are POSIX-style relative to `cwd`, matching `discover` output.
 * `-z` output keeps filenames containing quotes, newlines, or non-ASCII
 * bytes intact, and `--` disambiguates `base` from a path of the same name.
 * `base` may be any revision or range (e.g. `HEAD~1`, `main..HEAD`); values
 * starting with `-` are rejected so a flag can't be smuggled in.
 *
 * @throws If `cwd` is not inside a git repository or `base` is not a
 * valid revision. The message carries git's own error line.
 */
export async function changedMarkdownFiles(base: string, cwd: string): Promise<ChangedFiles> {
  if (base.startsWith("-")) {
    throw new Error(`Invalid git base: ${base}`);
  }
  const scanRoot = await realpath(cwd);
  let repoRoot: string;
  let addedDiff: string;
  let modified: string;
  let deleted: string;
  let untracked: string;
  try {
    const { stdout: top } = await runGit(["rev-parse", "--show-toplevel"], scanRoot);
    repoRoot = await realpath(top.replace(/\r?\n$/, ""));
    // --no-renames overrides the caller's diff.renames config: without it, a
    // renamed file can surface as status R, which none of the filters below
    // match, and the file silently disappears from all three arrays. Forcing
    // it off makes a rename resolve as delete (old path) + add (new path),
    // consistent with how deleted-doc stubs already work.
    const [a, m, del, u] = await Promise.all([
      runGit(
        ["diff", "--no-renames", "--no-ext-diff", "--name-only", "-z", "--diff-filter=A", base, "--"],
        repoRoot
      ),
      runGit(
        ["diff", "--no-renames", "--no-ext-diff", "--name-only", "-z", "--diff-filter=M", base, "--"],
        repoRoot
      ),
      runGit(
        ["diff", "--no-renames", "--no-ext-diff", "--name-only", "-z", "--diff-filter=D", base, "--"],
        repoRoot
      ),
      runGit(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
    ]);
    addedDiff = a.stdout;
    modified = m.stdout;
    deleted = del.stdout;
    untracked = u.stdout;
  } catch (err) {
    throw gitError(err);
  }
  return {
    added: collect(repoRoot, scanRoot, `${addedDiff}\0${untracked}`),
    modified: collect(repoRoot, scanRoot, modified),
    deleted: collect(repoRoot, scanRoot, deleted),
  };
}

/** Turn NUL-separated git output into sorted cwd-relative `.md` paths. */
function collect(repoRoot: string, scanRoot: string, out: string): string[] {
  const files = new Set<string>();
  for (const p of out.split("\0")) {
    if (!p) continue;
    const rel = toPosix(path.relative(scanRoot, path.join(repoRoot, p)));
    if (rel !== ".." && !rel.startsWith("../") && rel.toLowerCase().endsWith(".md")) {
      files.add(rel);
    }
  }
  return [...files].sort();
}

/** Re-wrap a failed git spawn with its own stderr line as the message. */
function gitError(err: unknown): Error {
  const stderr =
    err && typeof err === "object" && "stderr" in err && typeof err.stderr === "string"
      ? err.stderr.trim().split("\n").at(-1)
      : undefined;
  return new Error(stderr ? `git: ${stderr}` : "git command failed", { cause: err });
}
