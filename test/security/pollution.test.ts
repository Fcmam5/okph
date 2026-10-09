import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAffected, loadGraph, parseDoc, renderMermaid, validate } from "../../src/index.js";
import { buildGraph } from "../../src/graph.js";

/** Run `fn` with `Object.prototype` polluted, always restoring it afterwards. */
async function polluted<T>(props: Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const proto = Object.prototype as Record<string, unknown>;
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(proto, k, { value: v, configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(props)) delete proto[k];
  }
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "okph-pp-"));
  await writeFile(path.join(dir, "index.md"), "# I\n\n* [A](/a.md)\n");
  await writeFile(path.join(dir, "a.md"), "---\ndescription: d\n---\n# A\n");
  await writeFile(path.join(dir, "orphan.md"), "---\ntype: T\ndescription: d\n---\n# O\n");
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("polluted Object.prototype is not a gadget", () => {
  it("validate ignores inherited scope and ignore options", async () => {
    const r = await polluted({ scope: [], ignore: ["orphan", "missing-type"] }, () =>
      validate(dir)
    );
    expect(r.scopedCount).toBeUndefined();
    const kinds = r.diagnostics.map((d) => d.kind);
    expect(kinds).toContain("orphan");
    expect(kinds).toContain("missing-type");
  });

  it("validate does not read frontmatter fields from the prototype", async () => {
    const r = await polluted({ type: "T" }, () => validate(dir));
    expect(r.diagnostics.map((d) => `${d.kind}:${d.path}`)).toContain("missing-type:a.md");
  });

  it("parseDoc ignores an inherited title for docs without usable frontmatter", async () => {
    const titles = await polluted({ title: "spoofed" }, () => [
      parseDoc("no heading here", "plain.md").title,
      parseDoc("---\n[: bad\n---\nbody", "broken.md").title,
    ]);
    expect(titles).toEqual(["plain", "broken"]);
  });

  it("loadGraph ignores inherited exclude and extraPaths", async () => {
    const g = await polluted({ exclude: ["**"], extraPaths: ["ghost.md"] }, () => loadGraph(dir));
    expect(g.nodes.map((n) => n.path)).toEqual(["a.md", "index.md", "orphan.md"]);
  });

  it("renderMermaid ignores an inherited baseUrl", async () => {
    const g = await loadGraph(dir);
    const out = await polluted({ baseUrl: "https://evil.example/", highlight: ["a.md"] }, () =>
      renderMermaid(g)
    );
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("style ");
  });

  it("getAffected ignores an inherited includeNav", async () => {
    const g = buildGraph([
      { path: "index.md", title: "I", links: [{ text: "a", href: "a.md", kind: "internal", target: "a.md" }] },
      { path: "a.md", title: "A", links: [] },
    ]);
    const out = await polluted({ includeNav: true }, () => getAffected(g, ["a.md"]));
    expect(out).toEqual(["a.md"]);
  });
});
