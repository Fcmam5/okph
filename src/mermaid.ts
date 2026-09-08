import type { Graph } from "./graph.js";
import { escapeLabel, safeHref } from "./security.js";

/** Options controlling Mermaid rendering. */
export interface RenderOptions {
  /**
   * When set, node click links become absolute URLs joined onto this base
   * (e.g. a GitHub blob URL). When omitted, links are relative doc paths.
   */
  readonly baseUrl?: string;
}

/**
 * Render a document graph as a Mermaid `graph TD` diagram with clickable
 * nodes.
 *
 * Security: every label is escaped via `escapeLabel` and every click href is
 * validated via `safeHref`. A node whose href cannot be made safe is still
 * rendered, just without a `click` directive.
 */
export function renderMermaid(graph: Graph, options: RenderOptions = {}): string {
  const idByPath = new Map(graph.nodes.map((n) => [n.path, n.id]));
  const lines: string[] = ["graph TD"];

  for (const node of graph.nodes) {
    lines.push(`  ${node.id}["${escapeLabel(node.label)}"]`);
  }

  for (const edge of graph.edges) {
    const from = idByPath.get(edge.from);
    const to = idByPath.get(edge.to);
    if (from && to) lines.push(`  ${from} --> ${to}`);
  }

  for (const node of graph.nodes) {
    const href = safeHref(node.path, options.baseUrl);
    if (href !== null) lines.push(`  click ${node.id} "${href}"`);
  }

  return lines.join("\n");
}
