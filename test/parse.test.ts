import { describe, it, expect } from "vitest";
import { parseDoc } from "../src/parse.js";

describe("parseDoc links", () => {
  it("resolves an internal link relative to the doc's directory", () => {
    const doc = parseDoc("[B](nested/b.md)", "a.md");
    expect(doc.links).toEqual([
      { text: "B", href: "nested/b.md", kind: "internal", target: "nested/b.md" },
    ]);
  });

  it("resolves ../ links up the tree, normalized to root", () => {
    const doc = parseDoc("[A](../a.md)", "nested/b.md");
    expect(doc.links[0]!.target).toBe("a.md");
  });

  it("classifies http(s) links as external", () => {
    const doc = parseDoc("[X](https://example.com)", "a.md");
    expect(doc.links[0]).toEqual({
      text: "X",
      href: "https://example.com",
      kind: "external",
      target: "https://example.com",
    });
  });

  it("ignores pure anchor links", () => {
    const doc = parseDoc("[top](#section)", "a.md");
    expect(doc.links).toEqual([]);
  });

  it("strips fragments from internal targets", () => {
    const doc = parseDoc("[B](nested/b.md#part)", "a.md");
    expect(doc.links[0]!.target).toBe("nested/b.md");
  });
});

describe("parseDoc title", () => {
  it("prefers frontmatter title", () => {
    const doc = parseDoc("---\ntitle: My Title\n---\n# H1\n", "a.md");
    expect(doc.title).toBe("My Title");
  });

  it("falls back to first H1", () => {
    const doc = parseDoc("# The Heading\ntext", "a.md");
    expect(doc.title).toBe("The Heading");
  });

  it("falls back to filename stem", () => {
    const doc = parseDoc("no heading here", "nested/ledger.md");
    expect(doc.title).toBe("ledger");
  });
});
