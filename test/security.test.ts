import { describe, it, expect } from "vitest";
import { safeHref, escapeLabel, terminalSafe } from "../src/security.js";

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

  it("blocks bare scheme prefixes that are not real absolute URLs", () => {
    // A file can legitimately be named `https:evil.com.md`; new URL would
    // otherwise parse it as a cross-origin link.
    expect(safeHref("https:evil.com.md")).toBeNull();
    expect(safeHref("http:x")).toBeNull();
  });

  it("percent-encodes segments so encoded traversal cannot escape", () => {
    // `%2e%2e` is a literal directory name; encoding it to `%252e%252e`
    // keeps it in-tree both bare and when joined onto a base URL.
    expect(safeHref("%2e%2e/%2e%2e/x.md")).toBe("%252e%252e/%252e%252e/x.md");
    expect(safeHref("%2e%2e/%2e%2e/x.md", "https://gh.com/o/r/blob/main")).toBe(
      "https://gh.com/o/r/blob/main/%252e%252e/%252e%252e/x.md"
    );
  });

  it("encodes url-significant chars in filenames", () => {
    expect(safeHref("a#b.md")).toBe("a%23b.md");
    expect(safeHref("a b.md")).toBe("a%20b.md");
    expect(safeHref("a%20b.md")).toBe("a%2520b.md");
    expect(safeHref("a?b.md")).toBe("a%3Fb.md");
  });
});

describe("escapeLabel", () => {
  it("escapes quotes and collapses newlines", () => {
    expect(escapeLabel('a "b"\nc')).toBe('a #quot;b#quot; c');
  });

  it("neutralizes brackets used for mermaid node syntax", () => {
    expect(escapeLabel("x[y]z")).toBe("x#91;y#93;z");
  });

  it("neutralizes html and entity injection", () => {
    expect(escapeLabel("<img src=x>")).toBe("#60;img src=x#62;");
    // `&#60;` would decode to `<` in html renderers; `#60;` too.
    expect(escapeLabel("&#60;")).toBe("#38;#35;60;");
    expect(escapeLabel("a\\nb")).toBe("a#92;nb");
  });
});

describe("terminalSafe", () => {
  it("passes plain names through", () => {
    expect(terminalSafe("docs/a.md")).toBe("docs/a.md");
  });

  it("quotes names containing terminal control chars", () => {
    expect(terminalSafe("a\x1b[31m.md")).toBe(JSON.stringify("a\x1b[31m.md"));
    expect(terminalSafe("a\nb.md")).toBe(JSON.stringify("a\nb.md"));
  });

  it("renders bidirectional controls as visible Unicode escapes", () => {
    expect(terminalSafe("safe\u202Ecod.exe")).toBe("safe\\u202Ecod.exe");
  });
});
