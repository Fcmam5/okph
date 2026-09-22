import { describe, it, expect } from "vitest";
import { buildGraph } from "../src/graph.js";
import { renderMermaid } from "../src/mermaid.js";

const graph = buildGraph([
  { path: "a.md", title: "A", links: [{ text: "B", href: "b.md", kind: "internal", target: "b.md" }] },
  { path: "b.md", title: "B", links: [] },
]);

const idOf = (p: string) => graph.nodes.find((n) => n.path === p)!.id;

describe("renderMermaid", () => {
  it("emits a graph TD header", () => {
    expect(renderMermaid(graph).split("\n")[0]).toBe("graph TD");
  });

  it("renders nodes with labels and edges by id", () => {
    const out = renderMermaid(graph);
    expect(out).toContain(`${idOf("a.md")}["A"]`);
    expect(out).toContain(`${idOf("b.md")}["B"]`);
    expect(out).toContain(`${idOf("a.md")} --> ${idOf("b.md")}`);
  });

  it("draws edges out of reserved files dotted", () => {
    const g = buildGraph([
      { path: "index.md", title: "Index", links: [{ text: "A", href: "a.md", kind: "internal", target: "a.md" }] },
      { path: "log.md", title: "Log", links: [{ text: "A", href: "a.md", kind: "internal", target: "a.md" }] },
      { path: "a.md", title: "A", links: [] },
    ]);
    const id = (p: string) => g.nodes.find((n) => n.path === p)!.id;
    const out = renderMermaid(g);
    expect(out).toContain(`${id("index.md")} -.-> ${id("a.md")}`);
    expect(out).toContain(`${id("log.md")} -.-> ${id("a.md")}`);
  });

  it("emits relative click directives when no base url", () => {
    expect(renderMermaid(graph)).toContain(`click ${idOf("a.md")} "a.md"`);
  });

  it("emits absolute click directives with a base url", () => {
    const out = renderMermaid(graph, { baseUrl: "https://gh.com/o/r/blob/main" });
    expect(out).toContain(`click ${idOf("a.md")} "https://gh.com/o/r/blob/main/a.md"`);
  });

  it("escapes labels", () => {
    const g = buildGraph([{ path: "a.md", title: 'A "x" [y]', links: [] }]);
    expect(renderMermaid(g)).toContain('["A #quot;x#quot; #91;y#93;"]');
  });

  it("is deterministic", () => {
    expect(renderMermaid(graph)).toBe(renderMermaid(graph));
  });

  it("styles highlighted nodes only", () => {
    const out = renderMermaid(graph, { highlight: ["b.md", "gone.md"] });
    expect(out).toContain(`style ${idOf("b.md")} fill:`);
    expect(out).not.toContain(`style ${idOf("a.md")}`);
  });

  it("styles added/deleted with their own fills, last category wins", () => {
    const out = renderMermaid(graph, { added: ["a.md"], deleted: ["a.md", "b.md"] });
    expect(out).toContain(`style ${idOf("a.md")} fill:#ef9a9a`);
    expect(out).toContain(`style ${idOf("b.md")} fill:#ef9a9a`);
  });
});
