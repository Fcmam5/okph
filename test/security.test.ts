import { describe, it, expect } from "vitest";
import { safeHref, escapeLabel } from "../src/security.js";

describe("safeHref", () => {
  it("allows relative paths when no base url", () => {
    expect(safeHref("docs/ledger.md")).toBe("docs/ledger.md");
  });

  it("blocks javascript: scheme", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });

  it("blocks data: and file: schemes", () => {
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
  });

  it("allows http/https absolute urls", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
  });

  it("joins relative path onto base url without escaping origin", () => {
    expect(safeHref("docs/a.md", "https://gh.com/o/r/blob/main")).toBe(
      "https://gh.com/o/r/blob/main/docs/a.md"
    );
  });

  it("blocks path traversal that escapes the base url origin", () => {
    expect(safeHref("../../../etc/passwd", "https://gh.com/o/r/blob/main")).toBeNull();
  });

  it("blocks chars that break out of the click directive", () => {
    expect(safeHref('x".md')).toBeNull();
    expect(safeHref("x\n.md")).toBeNull();
    expect(safeHref("x\r.md")).toBeNull();
    expect(safeHref("x`.md")).toBeNull();
    expect(safeHref('x".md', "https://gh.com/o/r")).toBeNull();
  });
});

describe("escapeLabel", () => {
  it("escapes quotes and collapses newlines", () => {
    expect(escapeLabel('a "b"\nc')).toBe('a #quot;b#quot; c');
  });

  it("neutralizes brackets used for mermaid node syntax", () => {
    expect(escapeLabel("x[y]z")).toBe("x#91;y#93;z");
  });
});
