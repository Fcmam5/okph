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
 *
 * Returns the safe href, or `null` if the input must be dropped.
 */
export function safeHref(raw: string, baseUrl?: string): string | null {
  const target = raw.trim();
  if (!target || UNSAFE_HREF_CHARS_RE.test(target)) return null;

  const schemeMatch = SCHEME_RE.exec(target);

  // Absolute URL with an explicit scheme.
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase() + ":";
    if (!ALLOWED_SCHEMES.has(scheme)) return null;
    try {
      const parsed = new URL(target);
      return parsed.href;
    } catch {
      return null;
    }
  }

  // Protocol-relative (//host) is treated as unsafe: ambiguous origin.
  if (target.startsWith("//")) return null;

  // Relative path from here on.
  if (!baseUrl) {
    // Reject absolute filesystem paths; keep it relative and in-tree.
    if (target.startsWith("/")) return null;
    if (escapesRoot(target)) return null;
    return target;
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
  const joinedPath = path.posix.normalize(basePath + target.replace(/^\/+/, ""));
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
 * Uses Mermaid HTML-entity codes (`#nn;`) so the characters render literally
 * instead of being parsed as node/link syntax. Newlines are collapsed to
 * spaces to keep output on a single line.
 */
export function escapeLabel(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "#quot;")
    .replace(/\[/g, "#91;")
    .replace(/\]/g, "#93;");
}
