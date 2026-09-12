import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { discover, toPosix } from "./discover.js";
import { parseDoc } from "./parse.js";
import { buildGraph, neighborhood, type Graph, type GraphInput } from "./graph.js";
import { renderMermaid, type RenderOptions } from "./mermaid.js";

export { discover, toPosix, resolveDocPath } from "./discover.js";
export { parseDoc } from "./parse.js";
export {
  buildGraph,
  getAffected,
  getDependencies,
  getDependents,
  inducedSubgraph,
  neighborhood,
  subgraph,
} from "./graph.js";
export { renderMermaid } from "./mermaid.js";
export { safeHref, escapeLabel, terminalSafe } from "./security.js";
export { changedMarkdownFiles } from "./git.js";
export type { ParsedDoc, ParsedLink } from "./parse.js";
export type { Graph, GraphNode, GraphEdge, GraphInput } from "./graph.js";
export type { RenderOptions } from "./mermaid.js";

/** Options for {@link loadGraph}. */
export interface LoadGraphOptions {
  /**
   * Extra root-relative POSIX paths to include as stub nodes when absent on
   * disk — e.g. deleted documents. Edges from surviving documents to them are
   * kept, so impact analysis can still find their dependents.
   */
  readonly extraPaths?: readonly string[];
}

/** Refuse to read a single markdown file larger than this (DoS guard). */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/**
 * Read a folder of markdown documents and build the document graph.
 * Offline and read-only: it only reads files under `root`.
 *
 * @throws If a discovered file exceeds {@link MAX_DOC_BYTES}.
 */
export async function loadGraph(root: string, options: LoadGraphOptions = {}): Promise<Graph> {
  const files = await discover(root);
  const docs: GraphInput[] = await Promise.all(
    files.map(async (rel) => {
      const abs = path.join(root, rel);
      const info = await stat(abs);
      if (info.size > MAX_DOC_BYTES) {
        throw new Error(`File too large: ${rel} (${info.size} bytes, limit is ${MAX_DOC_BYTES})`);
      }
      const content = await readFile(abs, "utf8");
      const { title, links } = parseDoc(content, rel);
      return { path: rel, title, links };
    })
  );
  const seen = new Set(files);
  for (const p of options.extraPaths ?? []) {
    if (!seen.has(p)) {
      docs.push({ path: p, title: path.posix.basename(p, ".md"), links: [] });
    }
  }
  return buildGraph(docs);
}

/**
 * Read markdown documents and render a clickable Mermaid graph.
 *
 * A directory renders its complete document graph. A file renders that
 * document's immediate neighborhood, using its containing directory as the
 * graph root.
 * Offline and read-only: it returns a string and sanitizes untrusted content
 * during rendering.
 *
 * @throws If a file is not a discovered markdown document, or if the graph
 * exceeds the size limit unless `options.allowLarge` is enabled.
 */
export async function generateMermaid(
  root: string,
  options: RenderOptions = {}
): Promise<string> {
  const info = await stat(root);
  let graph: Graph;
  if (info.isFile()) {
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
