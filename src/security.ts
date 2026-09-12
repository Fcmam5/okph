import path from "node:path";

/**
 * Security boundary for graph output.
 *
 * Everything that flows from untrusted document content into the rendered
 * Mermaid graph MUST pass through here. The graph is rendered in a browser
 * context (GitHub, wikis, Mermaid Live), so unsafe hrefs are an XSS vector
 * and unescaped labels can break out of node syntax.
 */

/** Schemes that are explicitly allowed in absolute links. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** Matches any leading `scheme:` per RFC 3986. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Chars that can break out of a Mermaid `click "..."` directive or alter
 * URL path semantics in browsers (`\` is treated as `/` by WHATWG parsing).
 */
// oxlint-disable-next-line no-control-regex -- control chars are intentionally rejected
const UNSAFE_HREF_CHARS_RE = /["`\\\x00-\x1f]/;

/**
 * Validate and normalize a link target for use in a Mermaid `click` directive.
 *
 * - No base URL: only relative, in-tree paths are allowed. Absolute http(s)
 *   URLs are allowed as-is. Any other scheme (javascript:, data:, file:, ...)
 *   is rejected.
 * - With base URL: relative paths are joined onto the base, and the result
 *   must stay within the base origin+path (no traversal escape).
 * - Double quotes, backticks, backslashes, and control characters are rejected.
 *
 * Returns the safe href, or `null` if the input must be dropped.
 */
export function safeHref(raw: string, baseUrl?: string): string | null {
  const target = raw.trim();
  if (!target || UNSAFE_HREF_CHARS_RE.test(target)) return null;

  // Absolute URL: require `scheme://`. A bare `https:foo` is a legitimate
  // filename, and `new URL("https:evil.com")` would parse it as a cross-origin
  // link — so only the explicit `//` form counts as absolute.
  if (/^https?:\/\//i.test(target)) {
    try {
      const parsed = new URL(target);
      return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }
  if (SCHEME_RE.test(target)) return null;

  // Protocol-relative (//host) is treated as unsafe: ambiguous origin.
  if (target.startsWith("//")) return null;

  // Relative path. Percent-encode each literal segment so `%`, `#`, `?`,
  // `<`, `>` and spaces can't be reinterpreted during URL resolution —
  // raw `%2e%2e` segments would defeat both the traversal and the base-path
  // containment checks when the browser decodes them.
  const encoded = target.split("/").map(encodeURIComponent).join("/");

  if (!baseUrl) {
    // Reject absolute filesystem paths; keep it relative and in-tree.
    if (target.startsWith("/")) return null;
    if (escapesRoot(target)) return null;
    return encoded;
  }

  // Join relative path onto the base URL and confirm containment.
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.has(base.protocol)) return null;

  const basePath = base.pathname.endsWith("/") ? base.pathname : base.pathname + "/";
  const joinedPath = path.posix.normalize(basePath + encoded.replace(/^\/+/, ""));
  if (!joinedPath.startsWith(basePath)) return null; // traversal escaped base

  const result = new URL(base.origin);
  result.pathname = joinedPath;
  return result.href;
}

/** True if a relative path uses `..` to climb above its root. */
function escapesRoot(relPath: string): boolean {
  const normalized = path.posix.normalize(relPath);
  return normalized === ".." || normalized.startsWith("../");
}

/**
 * Escape a string for safe use as a Mermaid node label.
 *
 * Uses Mermaid entity codes (`#nn;`) so the characters render literally
 * instead of being parsed as node/link syntax or HTML. `#` and `&` must be
 * escaped first: they introduce entity references that renderers decode
 * (e.g. `#60;` becomes `<`, `&#60;` too), which would bypass the `<`/`>`
 * escaping. Newlines are collapsed to spaces to keep output on one line.
 */
export function escapeLabel(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/#/g, "#35;")
    .replace(/&/g, "#38;")
    .replace(/\\/g, "#92;")
    .replace(/"/g, "#quot;")
    .replace(/\[/g, "#91;")
    .replace(/\]/g, "#93;")
    .replace(/</g, "#60;")
    .replace(/>/g, "#62;");
}

/** Terminal control chars that must not reach stdout/stderr raw. */
// oxlint-disable-next-line no-control-regex -- control chars are intentionally rejected
const UNSAFE_TERMINAL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/;

/** Unicode characters that can alter the displayed direction of terminal text. */
const BIDI_CONTROL_CHARS_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Make an untrusted string (a git-supplied filename, a CLI-supplied revision)
 * safe to print to a terminal or CI log. Strings containing C0/C1 control
 * characters are JSON-quoted, while bidirectional controls are rendered as
 * visible Unicode escapes. Everything else passes through unchanged.
 */
export function terminalSafe(text: string): string {
  const printable = UNSAFE_TERMINAL_CHARS_RE.test(text) ? JSON.stringify(text) : text;
  return printable.replace(BIDI_CONTROL_CHARS_RE, (char) =>
    `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
  );
}
