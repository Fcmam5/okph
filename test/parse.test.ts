import { describe, it, expect } from "vitest";
import { parseDoc, splitFrontmatter } from "../src/parse.js";

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

describe("splitFrontmatter output hygiene", () => {
  it("never lets the yaml library print document content as a process warning", async () => {
    const warnings: Error[] = [];
    const onWarning = (w: Error) => warnings.push(w);
    process.on("warning", onWarning);
    try {
      const { frontmatter, malformed } = splitFrontmatter("---\nx: !foo y\u001b[31mRED\n---\n# A\n");
      await new Promise((resolve) => setImmediate(resolve));
      expect(malformed).toBe(false);
      expect(frontmatter).toHaveProperty("x");
      expect(warnings).toEqual([]);
    } finally {
      process.off("warning", onWarning);
    }
  });
});

describe("parseDoc edge cases", () => {
  it("drops a link with an empty destination", () => {
    expect(parseDoc("[nothing]() and [x](b.md)", "a.md").links.map((l) => l.target)).toEqual(["b.md"]);
  });

  it("falls back to the filename stem for an empty H1", () => {
    expect(parseDoc("#\n\nbody", "nested/ledger.md").title).toBe("ledger");
  });

  it("skips an empty H1 and uses the next non-empty one", () => {
    expect(parseDoc("#\n\n# Real", "a.md").title).toBe("Real");
  });

  it("flattens emphasis, code and a hard break in a heading title", () => {
    expect(parseDoc("# *Bold* `code` end", "a.md").title).toBe("Bold code end");
    expect(parseDoc("Line one  \nline two\n=====\n", "a.md").title).toContain("Line one");
  });

  it("finds links inside list items and table cells", () => {
    const md = "- [L](l.md)\n\n| H [h](h.md) |\n| --- |\n| [c](c.md) |\n";
    expect(parseDoc(md, "a.md").links.map((l) => l.target).sort()).toEqual(["c.md", "h.md", "l.md"]);
  });

  it("keeps the fragment of an internal link and drops a pure anchor", () => {
    const links = parseDoc("[a](b.md#sec) [self](#top)", "a.md").links;
    expect(links).toEqual([
      { text: "a", href: "b.md#sec", kind: "internal", target: "b.md", fragment: "sec" },
    ]);
  });

  it("classifies schemes and protocol-relative URLs as external", () => {
    const kinds = parseDoc("[a](mailto:x@y.z) [b](//cdn.example/x) [c](https://e.x)", "a.md").links.map(
      (l) => l.kind
    );
    expect(kinds).toEqual(["external", "external", "external"]);
  });

  it("keeps the raw input for a malformed percent-escape", () => {
    expect(parseDoc("[a](b%E0%A4%A.md)", "a.md").links[0]!.target).toBe("b%E0%A4%A.md");
  });

  it("uses a frontmatter title and ignores a non-string one", () => {
    expect(parseDoc("---\ntitle: Front\n---\n# H1\n", "a.md").title).toBe("Front");
    expect(parseDoc("---\ntitle: 42\n---\n# H1\n", "a.md").title).toBe("H1");
  });
});

describe("splitFrontmatter shapes", () => {
  it("rejects a YAML list or scalar block as malformed", () => {
    expect(splitFrontmatter("---\n- a\n- b\n---\nbody").malformed).toBe(true);
    expect(splitFrontmatter("---\njust text\n---\nbody").malformed).toBe(true);
  });

  it("tolerates a BOM and CRLF line endings", () => {
    const r = splitFrontmatter("\uFEFF---\r\ntype: T\r\n---\r\nbody");
    expect(r.frontmatter).toEqual({ type: "T" });
    expect(r.body).toBe("body");
  });

  it("treats an unclosed fence as no frontmatter", () => {
    const r = splitFrontmatter("---\ntype: T\nbody");
    expect(r.malformed).toBe(false);
    expect(Object.keys(r.frontmatter)).toEqual([]);
  });

  it("flags excessive YAML aliases instead of expanding them", () => {
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 150 }, (_, i) => `k${i}: *a`)].join("\n");
    expect(splitFrontmatter(`---\n${bomb}\n---\n`).malformed).toBe(true);
  });
});
