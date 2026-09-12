import path from "node:path";
import YAML from "yaml";
import { marked, type Token } from "marked";

/** A link discovered in a document body, classified for graph building. */
export interface ParsedLink {
  /** Human-visible link text. */
  readonly text: string;
  /** Raw destination as written in the markdown. */
  readonly href: string;
  /** Whether the link points at another in-tree document or off-site. */
  readonly kind: "internal" | "external";
  /**
   * For internal links: the target path relative to the bundle root (POSIX).
   * For external links: the original href.
   */
  readonly target: string;
  /** URL fragment (`#section`), without the leading `#`. */
  readonly fragment?: string;
}

/** A parsed document: enough to build a labelled, linked graph. */
export interface ParsedDoc {
  /** Display title: frontmatter.title -> first H1 -> filename stem. */
  readonly title: string;
  /** Links in document order (anchors and empty targets omitted). */
  readonly links: readonly ParsedLink[];
}

/** Matches leading YAML frontmatter delimited by `---` fences (BOM tolerated). */
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Matches any leading URL scheme (e.g. `https:`, `mailto:`). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Parse a single markdown document into a title and its classified links.
 * Pure and offline: no filesystem or network access.
 *
 * @param content   raw file contents
 * @param docRelPath the document's path relative to the bundle root (POSIX)
 */
export function parseDoc(content: string, docRelPath: string): ParsedDoc {
  const { frontmatter, body } = splitFrontmatter(content);
  const tokens = marked.lexer(body);
  const title = deriveTitle(frontmatter, tokens, docRelPath);
  const links = extractLinks(tokens, docRelPath);
  return { title, links };
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  const body = content.slice(match[0].length);
  try {
    const parsed = YAML.parse(match[1]!);
    if (parsed && typeof parsed === "object") {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
  } catch {
    // Malformed frontmatter is treated as absent; parsing must not throw.
  }
  return { frontmatter: {}, body };
}

function deriveTitle(
  frontmatter: Record<string, unknown>,
  tokens: Token[],
  docRelPath: string
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();

  for (const token of tokens) {
    if (token.type === "heading" && (token as { depth?: number }).depth === 1) {
      const text = inlineText((token as { tokens?: Token[] }).tokens).trim();
      if (text) return text;
    }
  }

  return path.posix.basename(docRelPath, ".md");
}

function extractLinks(tokens: Token[], docRelPath: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  walk(tokens, (token) => {
    if (token.type !== "link") return;
    const href = String((token as { href?: unknown }).href ?? "").trim();
    const text = String((token as { text?: unknown }).text ?? "").trim();
    const link = classify(href, text, docRelPath);
    if (link) links.push(link);
  });
  return links;
}

function classify(href: string, text: string, docRelPath: string): ParsedLink | null {
  if (!href) return null;

  // Off-site or non-path schemes (http, mailto, tel, ...) are external.
  if (SCHEME_RE.test(href) || href.startsWith("//")) {
    return { text, href, kind: "external", target: href };
  }

  // Drop the fragment; a pure anchor (`#x`) is a self-reference, not an edge.
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  if (!pathPart) return null;

  // A leading `/` is bundle-relative (per OKF spec), not filesystem-absolute.
  const decoded = safeDecode(pathPart);
  const resolved = decoded.startsWith("/")
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(docRelPath), decoded));
  return {
    text,
    href,
    kind: "internal",
    target: resolved,
    ...(hashIndex === -1 ? {} : { fragment: href.slice(hashIndex + 1) }),
  };
}

/** Flatten inline tokens to plain text, dropping markdown formatting. */
function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((t) => {
      const children = (t as { tokens?: Token[] }).tokens;
      if (children) return inlineText(children);
      return String((t as { text?: unknown }).text ?? (t as { raw?: unknown }).raw ?? "");
    })
    .join("");
}

/** Percent-decode a link path; malformed sequences keep the raw input. */
function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** Depth-first walk over marked tokens, visiting every nested token once. */
function walk(tokens: Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    const children = (token as { tokens?: Token[] }).tokens;
    if (children) walk(children, visit);
  }
}
