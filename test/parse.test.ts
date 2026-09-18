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

  it("strips fragments from internal targets but keeps them as metadata", () => {
    const doc = parseDoc("[B](nested/b.md#part)", "a.md");
    expect(doc.links[0]!.target).toBe("nested/b.md");
    expect(doc.links[0]!.fragment).toBe("part");
  });

  it("resolves bundle-relative links from the bundle root", () => {
    const doc = parseDoc("[X](/docs/x.md)", "wiki/a.md");
    expect(doc.links[0]!.target).toBe("docs/x.md");
  });

  it("decodes percent-encoded link targets", () => {
    const doc = parseDoc("[X](my%20doc.md)", "a.md");
    expect(doc.links[0]!.target).toBe("my doc.md");
  });

  it("keeps the raw target when percent-decoding fails", () => {
    const doc = parseDoc("[X](100%.md)", "a.md");
    expect(doc.links[0]!.target).toBe("100%.md");
  });

  it("finds links inside list items", () => {
    const doc = parseDoc("* [B](b.md) - one\n* [C](c.md) - two\n", "index.md");
    expect(doc.links.map((l) => l.target)).toEqual(["b.md", "c.md"]);
  });

  it("finds links inside nested list items", () => {
    const doc = parseDoc("* group\n  * [B](b.md)\n", "index.md");
    expect(doc.links.map((l) => l.target)).toEqual(["b.md"]);
  });

  it("finds links inside table cells", () => {
    const doc = parseDoc("| Doc | Note |\n|---|---|\n| [B](b.md) | see [C](c.md) |\n", "a.md");
    expect(doc.links.map((l) => l.target)).toEqual(["b.md", "c.md"]);
  });

  it("finds links inside blockquotes", () => {
    const doc = parseDoc("> see [B](b.md)\n", "a.md");
    expect(doc.links.map((l) => l.target)).toEqual(["b.md"]);
  });

  it("reports each distinct link once per occurrence, in document order", () => {
    const doc = parseDoc("[B](b.md)\n\n* [C](c.md)\n\n[B](b.md)\n", "a.md");
    expect(doc.links.map((l) => l.target)).toEqual(["b.md", "c.md", "b.md"]);
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

  it("detects frontmatter after a UTF-8 BOM", () => {
    const doc = parseDoc("﻿---\ntitle: Bom Title\n---\nbody", "a.md");
    expect(doc.title).toBe("Bom Title");
  });

  it("flattens markdown formatting inside H1 titles", () => {
    const doc = parseDoc("# **Bold** `code` end\ntext", "a.md");
    expect(doc.title).toBe("Bold code end");
  });

  it("falls back to filename stem", () => {
    const doc = parseDoc("no heading here", "nested/ledger.md");
    expect(doc.title).toBe("ledger");
  });
});
