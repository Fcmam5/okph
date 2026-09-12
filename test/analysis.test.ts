import { describe, it, expect } from "vitest";
import { buildGraph, getAffected, getDependencies, getDependents, inducedSubgraph, neighborhood, subgraph } from "../src/graph.js";

// payments -> settlement -> {ledger, reconciliation}
const docs = [
  { path: "payments.md", title: "Payments", links: [{ text: "s", href: "settlement.md", kind: "internal" as const, target: "settlement.md" }] },
  { path: "settlement.md", title: "Settlement", links: [
    { text: "l", href: "ledger.md", kind: "internal" as const, target: "ledger.md" },
    { text: "r", href: "reconciliation.md", kind: "internal" as const, target: "reconciliation.md" },
  ] },
  { path: "ledger.md", title: "Ledger", links: [] },
  { path: "reconciliation.md", title: "Reconciliation", links: [] },
];

describe("getDependencies", () => {
  it("returns direct outgoing links, sorted", () => {
    const g = buildGraph(docs);
    expect(getDependencies(g, "settlement.md")).toEqual(["ledger.md", "reconciliation.md"]);
    expect(getDependencies(g, "payments.md")).toEqual(["settlement.md"]);
    expect(getDependencies(g, "ledger.md")).toEqual([]);
  });
});

describe("getDependents", () => {
  it("returns direct incoming links, sorted", () => {
    const g = buildGraph(docs);
    expect(getDependents(g, "ledger.md")).toEqual(["settlement.md"]);
    expect(getDependents(g, "settlement.md")).toEqual(["payments.md"]);
    expect(getDependents(g, "payments.md")).toEqual([]);
  });
});

describe("neighborhood", () => {
  it("keeps the file plus direct deps and dependents", () => {
    const g = buildGraph([
      ...docs,
      { path: "orphan.md", title: "Orphan", links: [] },
    ]);
    const sub = neighborhood(g, "settlement.md");
    expect(sub.nodes.map((n) => n.path)).toEqual([
      "ledger.md",
      "payments.md",
      "reconciliation.md",
      "settlement.md",
    ]);
    expect(sub.edges).toEqual([
      { from: "payments.md", to: "settlement.md" },
      { from: "settlement.md", to: "ledger.md" },
      { from: "settlement.md", to: "reconciliation.md" },
    ]);
  });
});

describe("subgraph", () => {
  it('"deps" keeps the file plus its direct dependencies and their edges', () => {
    const g = buildGraph(docs);
    const sub = subgraph(g, "settlement.md", "deps");
    expect(sub.nodes.map((n) => n.path)).toEqual([
      "ledger.md",
      "reconciliation.md",
      "settlement.md",
    ]);
    expect(sub.edges).toEqual([
      { from: "settlement.md", to: "ledger.md" },
      { from: "settlement.md", to: "reconciliation.md" },
    ]);
  });

  it('"dependents" keeps the file plus its direct dependents and their edges', () => {
    const g = buildGraph(docs);
    const sub = subgraph(g, "settlement.md", "dependents");
    expect(sub.nodes.map((n) => n.path)).toEqual(["payments.md", "settlement.md"]);
    expect(sub.edges).toEqual([{ from: "payments.md", to: "settlement.md" }]);
  });

  it("returns an empty graph for unknown files", () => {
    const g = buildGraph(docs);
    expect(subgraph(g, "nope.md", "deps")).toEqual({ nodes: [], edges: [] });
  });
});

describe("getAffected", () => {
  it("returns the seed plus all transitive dependents, sorted", () => {
    const g = buildGraph(docs);
    expect(getAffected(g, ["ledger.md"])).toEqual([
      "ledger.md",
      "payments.md",
      "settlement.md",
    ]);
    expect(getAffected(g, ["settlement.md"])).toEqual(["payments.md", "settlement.md"]);
    expect(getAffected(g, ["payments.md"])).toEqual(["payments.md"]);
  });

  it("takes the union of multiple seeds", () => {
    const g = buildGraph(docs);
    expect(getAffected(g, ["ledger.md", "reconciliation.md"])).toEqual([
      "ledger.md",
      "payments.md",
      "reconciliation.md",
      "settlement.md",
    ]);
  });

  it("is safe on cycles", () => {
    const g = buildGraph([
      { path: "a.md", title: "A", links: [{ text: "b", href: "b.md", kind: "internal" as const, target: "b.md" }] },
      { path: "b.md", title: "B", links: [{ text: "c", href: "c.md", kind: "internal" as const, target: "c.md" }] },
      { path: "c.md", title: "C", links: [{ text: "a", href: "a.md", kind: "internal" as const, target: "a.md" }] },
    ]);
    expect(getAffected(g, ["a.md"])).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("ignores unknown seeds", () => {
    const g = buildGraph(docs);
    expect(getAffected(g, ["nope.md"])).toEqual([]);
  });
});

describe("inducedSubgraph", () => {
  it("keeps only the given nodes and the edges between them", () => {
    const g = buildGraph(docs);
    const sub = inducedSubgraph(g, getAffected(g, ["ledger.md"]));
    expect(sub.nodes.map((n) => n.path)).toEqual([
      "ledger.md",
      "payments.md",
      "settlement.md",
    ]);
    expect(sub.edges).toEqual([
      { from: "payments.md", to: "settlement.md" },
      { from: "settlement.md", to: "ledger.md" },
    ]);
  });
});
