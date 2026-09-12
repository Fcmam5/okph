import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { discover, toPosix } from "./discover.js";
import { parseDoc } from "./parse.js";
import { buildGraph, neighborhood, type Graph, type GraphInput } from "./graph.js";
import { renderMermaid, type RenderOptions } from "./mermaid.js";

export { discover, toPosix, resolveDocPath } from "./discover.js";
export { parseDoc } from "./parse.js";
export { buildGraph, getDependencies, getDependents, neighborhood, subgraph } from "./graph.js";
export { renderMermaid } from "./mermaid.js";
export { safeHref, escapeLabel } from "./security.js";
export type { ParsedDoc, ParsedLink } from "./parse.js";
export type { Graph, GraphNode, GraphEdge, GraphInput } from "./graph.js";
export type { RenderOptions } from "./mermaid.js";

/**
 * Read a folder of markdown documents and build the document graph.
 * Offline and read-only: it only reads files under `root`.
 */
export async function loadGraph(root: string): Promise<Graph> {
  const files = await discover(root);
  const docs: GraphInput[] = await Promise.all(
    files.map(async (rel) => {
      const content = await readFile(path.join(root, rel), "utf8");
      const { title, links } = parseDoc(content, rel);
      return { path: rel, title, links };
    })
  );
  return buildGraph(docs);
}

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
  const info = await stat(root);
  let graph: Graph;
  if (info.isFile()) {
    // A file input renders that document's immediate neighborhood.
    const dir = path.dirname(root);
    graph = neighborhood(await loadGraph(dir), toPosix(path.basename(root)));
    if (graph.nodes.length === 0) {
      throw new Error(`Not a known document: ${root}`);
    }
  } else {
    graph = await loadGraph(root);
  }
  if (!options.allowLarge && (graph.nodes.length > 500 || graph.edges.length > 500)) {
    throw new Error(
      `Graph has ${graph.nodes.length} nodes and ${graph.edges.length} edges, which exceeds the 500 node/edge limit. Some renderers (e.g. GitHub) will not display it. Pass allowLarge: true to render anyway.`
    );
  }
  return renderMermaid(graph, options);
}
