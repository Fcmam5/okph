import { createHash } from "node:crypto";
import type { ParsedLink } from "./parse.js";

/** Input to the graph builder: a parsed doc plus its root-relative path. */
export interface GraphInput {
  readonly path: string;
  readonly title: string;
  readonly links: readonly ParsedLink[];
}

/** A graph node, one per document. */
export interface GraphNode {
  /** Deterministic, Mermaid-safe identifier derived from `path`. */
  readonly id: string;
  /** Root-relative POSIX path; the canonical node identity. */
  readonly path: string;
  /** Display label (document title). */
  readonly label: string;
}

/** A directed edge: `from` links to `to` (both are node paths). */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/** A resolved document graph. */
export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * Build a directed graph from parsed documents.
 *
 * - One node per input document (sorted by path for deterministic output).
 * - One edge per internal link whose target is a known document.
 * - Links to non-existent targets are dropped (broken links are not edges).
 * - Duplicate edges are collapsed.
 *
 * Pure: no I/O. External links are ignored here (the graph is doc-to-doc).
 */
export function buildGraph(docs: readonly GraphInput[]): Graph {
  const known = new Set(docs.map((d) => d.path));

  const nodes: GraphNode[] = docs
    .map((d) => ({ id: nodeId(d.path), path: d.path, label: d.title }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) {
    throw new Error("Node id collision: two documents produced the same node id.");
  }

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const doc of docs) {
    for (const link of doc.links) {
      if (link.kind !== "internal") continue;
      if (!known.has(link.target)) continue;
      const key = `${doc.path}\u0000${link.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: doc.path, to: link.target });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { nodes, edges };
}

/**
 * Direct internal dependencies: the paths `file` links to, sorted.
 * Unknown files yield an empty list.
 */
export function getDependencies(graph: Graph, file: string): string[] {
  return graph.edges
    .filter((e) => e.from === file)
    .map((e) => e.to)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Direct dependents: the paths that link to `file`, sorted.
 * Unknown files yield an empty list.
 */
export function getDependents(graph: Graph, file: string): string[] {
  return graph.edges
    .filter((e) => e.to === file)
    .map((e) => e.from)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Subgraph containing `file` plus its direct dependencies and dependents:
 * the file's immediate neighborhood. Unknown files yield an empty graph.
 */
export function neighborhood(graph: Graph, file: string): Graph {
  if (!graph.nodes.some((n) => n.path === file)) {
    return { nodes: [], edges: [] };
  }
  const keep = new Set([file]);
  for (const e of graph.edges) {
    if (e.from === file) keep.add(e.to);
    if (e.to === file) keep.add(e.from);
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.path)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/** Deterministic, collision-resistant, Mermaid-safe node id from a path. */
function nodeId(path: string): string {
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 8);
  return `n_${hash}`;
}
