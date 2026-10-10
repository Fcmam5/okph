import { describe, it, expect } from "vitest";
import { injectGraph, writeFileAtomic } from "../src/readme.js";

const GRAPH = "graph TD\n  n_1[\"A\"]";
const wrap = (inner: string, eol = "\n") =>
  ["# Title", "", "<!-- okph:start -->", ...inner.split("\n").filter(Boolean), "<!-- okph:end -->", "", "tail", ""].join(eol);

describe("injectGraph", () => {
  it("replaces what is between the markers with a fenced mermaid block", () => {
    const out = injectGraph(wrap("stale"), GRAPH);
    expect(out).toBe(
      '# Title\n\n<!-- okph:start -->\n```mermaid\ngraph TD\n  n_1["A"]\n```\n<!-- okph:end -->\n\ntail\n'
    );
  });

  it("is idempotent", () => {
    const once = injectGraph(wrap("stale"), GRAPH);
    expect(injectGraph(once, GRAPH)).toBe(once);
  });

  it("keeps CRLF line endings", () => {
    const out = injectGraph(wrap("stale", "\r\n"), GRAPH);
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toContain("```mermaid\r\ngraph TD\r\n");
  });

  it("throws an actionable error when there are no markers", () => {
    expect(() => injectGraph("# Title\n", GRAPH)).toThrow(
      /No <!-- okph:start --> \/ <!-- okph:end --> markers found.*own line/
    );
  });

  it("throws when a marker is missing, duplicated or out of order", () => {
    const start = "<!-- okph:start -->";
    const end = "<!-- okph:end -->";
    for (const bad of [
      `${start}\n`,
      `${end}\n`,
      `${end}\n${start}\n`,
      `${start}\n${end}\n${start}\n${end}\n`,
    ]) {
      expect(() => injectGraph(bad, GRAPH)).toThrow(/exactly one/);
    }
  });

  it("only treats markers on their own line as markers", () => {
    expect(() => injectGraph("text <!-- okph:start --> text <!-- okph:end -->\n", GRAPH)).toThrow(
      /No <!-- okph:start -->/
    );
  });

  it("ignores markers shown inside fenced code blocks", () => {
    const doc = [
      "Use markers like this:",
      "```md",
      "<!-- okph:start -->",
      "<!-- okph:end -->",
      "```",
      "",
      "<!-- okph:start -->",
      "<!-- okph:end -->",
      "",
    ].join("\n");
    const out = injectGraph(doc, GRAPH);
    expect(out).toContain("```md\n<!-- okph:start -->\n<!-- okph:end -->\n```");
    expect(out.match(/```mermaid/g)).toHaveLength(1);
  });
});

describe("injectGraph fence handling", () => {
  const M = "<!-- okph:start -->\n<!-- okph:end -->\n";

  it("throws for empty content", () => {
    expect(() => injectGraph("", GRAPH)).toThrow(/No <!-- okph:start -->/);
  });

  it("does not close a ``` fence with a different fence character", () => {
    const doc = "```\n~~~\n" + M + "```\n" + M;
    const out = injectGraph(doc, GRAPH);
    expect(out.match(/```mermaid/g)).toHaveLength(1);
  });

  it("does not close a fence with a shorter fence or one carrying an info string", () => {
    const doc = "````\n```\n```js\n" + M + "````\n" + M;
    expect(injectGraph(doc, GRAPH).match(/```mermaid/g)).toHaveLength(1);
  });

  it("keeps a longer fence open until a fence at least as long closes it", () => {
    const block = '```mermaid\ngraph TD\n  n_1["A"]\n```\n';
    const shorterDoesNotClose = "````\n```\n" + M + "````\n";
    expect(injectGraph(shorterDoesNotClose + M, GRAPH)).toBe(
      shorterDoesNotClose + "<!-- okph:start -->\n" + block + "<!-- okph:end -->\n"
    );
    const longerCloses = "```\n" + M + "`````\n";
    expect(injectGraph(longerCloses + M, GRAPH)).toBe(
      longerCloses + "<!-- okph:start -->\n" + block + "<!-- okph:end -->\n"
    );
  });

  it("supports a ~~~ fence", () => {
    const doc = "~~~\n" + M + "~~~\n" + M;
    expect(injectGraph(doc, GRAPH).match(/```mermaid/g)).toHaveLength(1);
  });

  it("handles a final marker line without a trailing newline", () => {
    const out = injectGraph("<!-- okph:start -->\n<!-- okph:end -->", GRAPH);
    expect(out.endsWith("<!-- okph:end -->")).toBe(true);
  });
});

describe("writeFileAtomic", () => {
  it("writes the content and cleans up when the rename fails", async () => {
    const { mkdtemp, mkdir, readdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "okph-atomic-"));
    try {
      const ok = path.join(dir, "ok.md");
      await writeFileAtomic(ok, "hello", 0o644);
      expect(await (await import("node:fs/promises")).readFile(ok, "utf8")).toBe("hello");

      // Renaming a file over a non-empty directory fails; the temp file must not linger.
      const target = path.join(dir, "taken");
      await mkdir(target);
      await writeFile(path.join(target, "x"), "x");
      await expect(writeFileAtomic(target, "data", 0o644)).rejects.toThrow();
      expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
