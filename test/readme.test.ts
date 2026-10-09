import { describe, it, expect } from "vitest";
import { injectGraph } from "../src/readme.js";

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
