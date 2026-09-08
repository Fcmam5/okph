import { readFile } from "node:fs/promises";
import path from "node:path";
import { discover } from "./discover.js";
import { parseDoc } from "./parse.js";
import { buildGraph, type GraphInput } from "./graph.js";
import { renderMermaid, type RenderOptions } from "./mermaid.js";

export { discover } from "./discover.js";
export { parseDoc } from "./parse.js";
export { buildGraph } from "./graph.js";
export { renderMermaid } from "./mermaid.js";
export { safeHref, escapeLabel } from "./security.js";
export type { ParsedDoc, ParsedLink } from "./parse.js";
export type { Graph, GraphNode, GraphEdge, GraphInput } from "./graph.js";
export type { RenderOptions } from "./mermaid.js";

/**
 * Read a folder of markdown documents and render a clickable Mermaid graph.
 *
 * Offline and read-only: it only reads files under `root` and returns a
 * string. All untrusted content is sanitized during rendering.
 */
export async function generateMermaid(
  root: string,
  options: RenderOptions = {}
): Promise<string> {
  const files = await discover(root);
  const docs: GraphInput[] = await Promise.all(
    files.map(async (rel) => {
      const content = await readFile(path.join(root, rel), "utf8");
      const { title, links } = parseDoc(content, rel);
      return { path: rel, title, links };
    })
  );
  const graph = buildGraph(docs);
  return renderMermaid(graph, options);
}
