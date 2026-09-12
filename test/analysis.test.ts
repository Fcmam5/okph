import { describe, it, expect } from "vitest";
import { buildGraph, getDependencies, getDependents, neighborhood, subgraph } from "../src/graph.js";

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
