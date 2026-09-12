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
