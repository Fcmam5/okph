import { chmod, rename, rm, writeFile } from "node:fs/promises";

const START = "<!-- okph:start -->";
const END = "<!-- okph:end -->";
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Replace the block between the `okph:start` / `okph:end` marker lines with
 * `graph` in a fenced `mermaid` block. Markers must sit on their own line,
 * outside fenced code (docs can show them as examples), exactly once each.
 * Line endings of the start marker are kept. Pure: no I/O.
 *
 * @throws If the markers are missing, duplicated, or out of order.
 */
export function injectGraph(content: string, graph: string): string {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const starts: number[] = [];
  const ends: number[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const text = line.replace(/\r?\n$/, "");
    const open = FENCE_RE.exec(text);
    if (open) {
      const marker = open[1]!;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !open[2]!.trim()) {
        fence = null;
      }
      return;
    }
    if (fence !== null) return;
    if (text.trim() === START) starts.push(i);
    else if (text.trim() === END) ends.push(i);
  });

  if (starts.length === 0 && ends.length === 0) {
    throw new Error(
      `No ${START} / ${END} markers found. Add both, each on its own line, where the graph should go.`
    );
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! > ends[0]!) {
    throw new Error(
      `Expected exactly one ${START} followed by one ${END}, each on its own line (found ${starts.length} start, ${ends.length} end). Fix the markers and retry.`
    );
  }

  const [s, e] = [starts[0]!, ends[0]!];
  const eol = lines[s]!.endsWith("\r\n") ? "\r\n" : "\n";
  const block = ["```mermaid", ...graph.split("\n"), "```"].join(eol) + eol;
  return lines.slice(0, s + 1).join("") + block + lines.slice(e).join("");
}

/**
 * Replace `file` with `content` via a sibling temp file and rename, keeping
 * the original permission bits. Never follows or replaces through a symlink
 * (the caller has already checked `file` is a regular file).
 */
export async function writeFileAtomic(file: string, content: string, mode: number): Promise<void> {
  const tmp = `${file}.okph-${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, { flag: "wx", mode });
    await chmod(tmp, mode);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
