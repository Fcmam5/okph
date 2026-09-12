import { describe, it, expect } from "vitest";
import path from "node:path";
import { generateMermaid } from "../src/index.js";

const fixtures = path.resolve(import.meta.dirname, "fixtures/docs");

describe("generateMermaid", () => {
  it("produces a clickable graph for a folder", async () => {
    const out = await generateMermaid(fixtures);
    expect(out.split("\n")[0]).toBe("graph TD");
    expect(out).toContain('["A"]');
    expect(out).toContain('["B"]');
    expect(out).toMatch(/n_[0-9a-f]{8} --> n_[0-9a-f]{8}/);
    expect(out).toContain('click');
    expect(out).toContain('"a.md"');
    expect(out).toContain('"nested/b.md"');
  });

  it("honors a base url", async () => {
    const out = await generateMermaid(fixtures, { baseUrl: "https://gh.com/o/r/blob/main" });
    expect(out).toContain('"https://gh.com/o/r/blob/main/a.md"');
  });
});
