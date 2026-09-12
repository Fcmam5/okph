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

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
