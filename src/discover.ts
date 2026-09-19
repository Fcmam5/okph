import { opendir } from "node:fs/promises";
import path from "node:path";

const IGNORED = new Set([".git", "node_modules", "dist"]);

/**
 * Recursively find all `.md` files under `root`.
 * Returns POSIX-style paths relative to `root`, sorted lexicographically.
 */
export async function discover(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];

  for (let i = 0; i < queue.length; i++) {
    const dir = queue[i]!;
    const dh = await opendir(dir);
    for await (const ent of dh) {
      if (IGNORED.has(ent.name) || ent.name.startsWith(".")) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        queue.push(abs);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        results.push(toPosix(path.relative(root, abs)));
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

/** Convert the current platform's path separators to POSIX-style slashes. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

const RESERVED_RE = /(^|\/)(index|log)\.md$/i;

/**
 * True for OKF reserved filenames (spec §3.1): `index.md` directory listings
 * and `log.md` update histories, at any depth. Links out of them enumerate
 * or chronicle documents rather than relying on them, so they are not
 * dependency edges for analysis.
 */
export function isReservedFile(relPath: string): boolean {
  return RESERVED_RE.test(relPath);
}

/**
 * Resolve `target` (as typed by a user) to a root-relative POSIX path,
 * or `null` if it escapes `root` or is empty.
 *
 * `from` is the directory the user typed `target` against — their shell's cwd.
 * It defaults to `root`, and differs from it when the scan root was narrowed
 * with `--root`.
 */
export function resolveDocPath(root: string, target: string, from: string = root): string | null {
  const rel = toPosix(path.relative(root, path.resolve(from, target)));
  if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return null;
  }
  return rel;
}
