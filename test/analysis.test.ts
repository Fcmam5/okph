import { describe, it, expect } from "vitest";
import { buildGraph, getDependencies, getDependents } from "../src/graph.js";

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
