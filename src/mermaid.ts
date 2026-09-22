import type { Graph } from "./graph.js";
import { isReservedFile } from "./discover.js";
import { escapeLabel, safeHref } from "./security.js";

/** Options controlling Mermaid rendering. */
export interface RenderOptions {
  /**
   * When set, node click links become absolute URLs joined onto this base
   * (e.g. a GitHub blob URL). When omitted, links are relative doc paths.
   */
  readonly baseUrl?: string;
  /**
   * Bypass the 500 node/edge safety limit.
   */
  readonly allowLarge?: boolean;
  /**
   * Paths to emphasize with a filled style — the queried document, or
   * modified seeds — so they stand out among their dependencies.
   */
  readonly highlight?: readonly string[];
  /**
   * Paths added since the compared revision — drawn with a green fill.
   */
  readonly added?: readonly string[];
  /**
   * Paths deleted since the compared revision — drawn with a red fill.
   */
  readonly deleted?: readonly string[];
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
    // Edges out of reserved files (index listings, logs) are dotted so the
    // citation graph stays legible underneath them.
    if (from && to) lines.push(`  ${from} ${isReservedFile(edge.from) ? "-.->" : "-->"} ${to}`);
  }

  for (const node of graph.nodes) {
    const href = safeHref(node.path, options.baseUrl);
    if (href !== null) lines.push(`  click ${node.id} "${href}"`);
  }

  // Explicit color:#000 keeps text readable on the fills in both light and
  // dark Mermaid themes. Iterate graph.nodes (not the option arrays) so
  // style lines stay in deterministic node order and can't be duplicated.
  const styles = new Map<string, string>();
  for (const p of options.highlight ?? []) {
    styles.set(p, "fill:#ffb300,stroke:#e65100,color:#000");
  }
  for (const p of options.added ?? []) {
    styles.set(p, "fill:#a5d6a7,stroke:#2e7d32,color:#000");
  }
  for (const p of options.deleted ?? []) {
    styles.set(p, "fill:#ef9a9a,stroke:#c62828,color:#000");
  }
  for (const node of graph.nodes) {
    const style = styles.get(node.path);
    if (style) lines.push(`  style ${node.id} ${style}`);
  }

  return lines.join("\n");
}
