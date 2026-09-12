import { describe, it, expect } from "vitest";
import { buildGraph } from "../src/graph.js";

const docs = [
  { path: "a.md", title: "A", links: [{ text: "B", href: "b.md", kind: "internal" as const, target: "b.md" }] },
  { path: "b.md", title: "B", links: [] },
];

describe("buildGraph", () => {
  it("creates one node per doc, sorted by path, with stable ids", () => {
    const g1 = buildGraph(docs);
    const g2 = buildGraph(docs);
    expect(g1.nodes.map((n) => n.path)).toEqual(["a.md", "b.md"]);
    expect(g1.nodes.map((n) => n.label)).toEqual(["A", "B"]);
    expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id));
    expect(new Set(g1.nodes.map((n) => n.id)).size).toBe(2);
  });

  it("adds internal edges between existing docs", () => {
    const g = buildGraph(docs);
    expect(g.edges).toEqual([{ from: "a.md", to: "b.md" }]);
  });

  it("drops links to non-existent targets", () => {
    const g = buildGraph([
      { path: "a.md", title: "A", links: [{ text: "x", href: "missing.md", kind: "internal" as const, target: "missing.md" }] },
    ]);
    expect(g.edges).toEqual([]);
  });

  it("dedups duplicate edges", () => {
    const g = buildGraph([
      { path: "a.md", title: "A", links: [
        { text: "B", href: "b.md", kind: "internal" as const, target: "b.md" },
        { text: "again", href: "b.md", kind: "internal" as const, target: "b.md" },
      ] },
      { path: "b.md", title: "B", links: [] },
    ]);
    expect(g.edges).toEqual([{ from: "a.md", to: "b.md" }]);
  });
});
