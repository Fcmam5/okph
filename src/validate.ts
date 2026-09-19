import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import { discover } from "./discover.js";
import { MAX_DOC_BYTES } from "./limits.js";
import { parseDoc, splitFrontmatter } from "./parse.js";
import { terminalSafe } from "./security.js";

/** Severity of a validation diagnostic. */
export type DiagnosticLevel = "error" | "warning";

/** One validation finding. `kind` doubles as the rule id. */
export interface Diagnostic {
  readonly level: DiagnosticLevel;
  readonly kind: string;
  /** Document the diagnostic belongs to (root-relative POSIX path). */
  readonly path: string;
  /** For link diagnostics: the target that failed. */
  readonly target?: string;
  readonly message: string;
}

/** Validation output: findings plus which OKF version was applied. */
export interface ValidateResult {
  readonly diagnostics: readonly Diagnostic[];
  /** OKF version used, from `okf_version` or the latest supported. */
  readonly version: string;
  readonly errorCount: number;
  readonly warningCount: number;
}

/** OKF versions this build knows how to check. Newest first. */
const SUPPORTED_VERSIONS = ["0.2"] as const;

/** Reserved filenames (spec §3.1): index listings and update logs. */
const RESERVED_RE = /(^|\/)(index|log)\.md$/i;
const INDEX_RE = /(^|\/)index\.md$/i;
const LOG_RE = /(^|\/)log\.md$/i;

/** The bundle-root index may carry only this frontmatter key (spec §8). */
const ROOT_INDEX_KEYS = new Set(["okf_version"]);

/** ISO 8601 `YYYY-MM-DD`, required on log headings (spec §9). */
const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `status` values (spec §5.4). Absent means `stable`. */
const STATUS_VALUES = new Set(["draft", "stable", "deprecated"]);

/** URI scheme like `https:` or `urn:` — a path-valued field is not a path. */
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** A trailing file extension with at least one letter, e.g. `.md`, `.py`. */
const FILE_EXT_RE = /\.[a-z][a-z0-9]{0,7}$/i;

/**
 * Check a folder of markdown documents against the OKF spec, without
 * building or failing the graph. Read-only.
 *
 * Errors map to spec MUSTs (§11 conformance); warnings map to SHOULDs and
 * tolerated-but-noticeable issues like broken links (§6.1 lets them be
 * "not-yet-written knowledge"). Diagnostics are sorted by path and
 * deduplicated per (path, kind, target).
 */
export async function validate(root: string): Promise<ValidateResult> {
  const files = await discover(root);
  const known = new Set(files);
  const diagnostics: Diagnostic[] = [];
  const incoming = new Map<string, number>();

  const version = await resolveVersion(root, files, diagnostics);

  for (const rel of files) {
    const abs = path.join(root, rel);
    const info = await stat(abs);
    if (info.size > MAX_DOC_BYTES) {
      diagnostics.push({
        level: "error",
        kind: "file-too-large",
        path: rel,
        message: `file exceeds the ${MAX_DOC_BYTES} byte limit`,
      });
      continue;
    }

    const content = await readFile(abs, "utf8");
    const { frontmatter, body, malformed } = splitFrontmatter(content);
    const reserved = RESERVED_RE.test(rel);

    checkFrontmatter(frontmatter, malformed, rel, reserved, diagnostics);
    if (LOG_RE.test(rel)) checkLog(body, rel, diagnostics);

    if (!reserved) {
      for (const field of pathFields(frontmatter)) {
        const target = resolvePath(rel, field.value);
        if (target === null) {
          diagnostics.push({
            level: "warning",
            kind: "escapes-bundle",
            path: rel,
            target: field.value,
            message: `${field.name} resolves above the bundle root: ${terminalSafe(field.value)}`,
          });
        } else if (!(await exists(path.join(root, target)))) {
          diagnostics.push({
            level: "warning",
            kind: "missing-resource",
            path: rel,
            target: field.value,
            message: `${field.name} points at a file that does not exist: ${terminalSafe(field.value)}`,
          });
        }
      }
    }

    const doc = parseDoc(content, rel);
    for (const link of doc.links) {
      if (link.kind !== "internal") continue;
      const target = link.target;
      if (target === ".." || target.startsWith("../")) {
        diagnostics.push({
          level: "warning",
          kind: "escapes-bundle",
          path: rel,
          target,
          message: `link resolves above the bundle root: ${terminalSafe(link.href)}`,
        });
        continue;
      }
      if (target.toLowerCase().endsWith(".md")) {
        if (known.has(target)) {
          const href = link.href.split("#")[0]!;
          if (!href.startsWith("/")) {
            diagnostics.push({
              level: "warning",
              kind: "prefer-absolute-links",
              path: rel,
              target,
              message: `relative link (spec §6.1 recommends /absolute form): ${terminalSafe(link.href)}`,
            });
          }
          incoming.set(target, (incoming.get(target) ?? 0) + 1);
        } else {
          diagnostics.push({
            level: "warning",
            kind: "missing-doc",
            path: rel,
            target,
            message: `link to a document that does not exist: ${terminalSafe(link.href)}`,
          });
        }
      } else if (!(await exists(path.join(root, target)))) {
        diagnostics.push({
          level: "warning",
          kind: "missing-file",
          path: rel,
          target,
          message: `link to a file that does not exist: ${terminalSafe(link.href)}`,
        });
      }
    }
  }

  if (!files.some((f) => f.toLowerCase() === "index.md")) {
    diagnostics.push({
      level: "warning",
      kind: "recommended-index",
      path: "index.md",
      message: "no bundle-root index.md — readers have no entry point (spec §8)",
    });
  }
  for (const rel of files) {
    if (!RESERVED_RE.test(rel) && !incoming.has(rel)) {
      diagnostics.push({
        level: "warning",
        kind: "orphan",
        path: rel,
        message: "no document links here; it cannot be reached",
      });
    }
  }

  const deduped = dedupe(diagnostics).sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.kind.localeCompare(b.kind) ||
      (a.target ?? "").localeCompare(b.target ?? "")
  );
  const errorCount = deduped.filter((d) => d.level === "error").length;
  return {
    diagnostics: deduped,
    version,
    errorCount,
    warningCount: deduped.length - errorCount,
  };
}

/**
 * Frontmatter checks for one document. Errors track spec §11 conformance;
 * reserved files follow §8/§9 instead of the concept rules.
 */
function checkFrontmatter(
  frontmatter: Record<string, unknown>,
  malformed: boolean,
  rel: string,
  reserved: boolean,
  out: Diagnostic[]
): void {
  if (malformed) {
    out.push({
      level: "error",
      kind: "malformed-frontmatter",
      path: rel,
      message: "frontmatter block is not a parseable YAML mapping",
    });
    return;
  }

  const keys = Object.keys(frontmatter);
  if (INDEX_RE.test(rel)) {
    const isRoot = rel.toLowerCase() === "index.md";
    const extra = keys.filter((k) => !(isRoot && ROOT_INDEX_KEYS.has(k)));
    if (extra.length > 0) {
      out.push({
        level: "error",
        kind: "index-frontmatter",
        path: rel,
        message: isRoot
          ? `root index.md may only declare okf_version; found: ${extra.map(terminalSafe).join(", ")}`
          : "non-root index.md must not contain frontmatter (spec §8)",
      });
    }
    return;
  }
  if (reserved) return; // §9 does not forbid log.md frontmatter.

  if (keys.length === 0) {
    out.push({
      level: "error",
      kind: "missing-frontmatter",
      path: rel,
      message: "concept document has no frontmatter block (spec §11)",
    });
    return;
  }

  const type = frontmatter.type;
  if (typeof type !== "string" || !type.trim()) {
    out.push({
      level: "error",
      kind: "missing-type",
      path: rel,
      message: "missing required frontmatter key `type` (spec §4.1)",
    });
  }

  const description = frontmatter.description;
  if (typeof description !== "string" || !description.trim()) {
    out.push({
      level: "warning",
      kind: "recommended-description",
      path: rel,
      message: "no `description`; index generators and previews use it (spec §4.1)",
    });
  }

  const sources = frontmatter.sources;
  if (sources !== undefined) {
    if (!Array.isArray(sources)) {
      out.push({
        level: "warning",
        kind: "missing-source-resource",
        path: rel,
        message: "`sources` is not a list (spec §5.1)",
      });
    } else {
      sources.forEach((entry, i) => {
        const resource =
          entry && typeof entry === "object"
            ? (entry as Record<string, unknown>).resource
            : undefined;
        if (typeof resource !== "string" || !resource.trim()) {
          out.push({
            level: "warning",
            kind: "missing-source-resource",
            path: rel,
            message: `sources[${i}] has no required \`resource\` value (spec §5.1)`,
          });
        }
      });
    }
  }

  const status = frontmatter.status;
  if (status !== undefined && (typeof status !== "string" || !STATUS_VALUES.has(status))) {
    out.push({
      level: "warning",
      kind: "invalid-status",
      path: rel,
      message: "`status` must be draft, stable, or deprecated (spec §5.4)",
    });
  }

  const tags = frontmatter.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
    out.push({
      level: "warning",
      kind: "invalid-tags",
      path: rel,
      message: "`tags` should be a list of strings (spec §4.1)",
    });
  }

  const generated = frontmatter.generated;
  if (generated !== undefined) {
    const by =
      generated && typeof generated === "object" && !Array.isArray(generated)
        ? (generated as Record<string, unknown>).by
        : undefined;
    if (typeof by !== "string" || !by.trim()) {
      out.push({
        level: "warning",
        kind: "invalid-generated",
        path: rel,
        message: "`generated` has no required `by` actor (spec §5.2)",
      });
    }
  }

  const verified = frontmatter.verified;
  if (verified !== undefined) {
    // A bare mapping is a one-element list (spec §5.2, §11).
    const entries = Array.isArray(verified) ? verified : [verified];
    entries.forEach((entry, i) => {
      const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
      const by = e?.by;
      const at = e?.at;
      if (typeof by !== "string" || !by.trim() || at === undefined) {
        out.push({
          level: "warning",
          kind: "invalid-verified",
          path: rel,
          message: `verified[${i}] needs a \`by\` actor and an \`at\` time (spec §5.2)`,
        });
      }
    });
  }
}

/**
 * `##` headings in a log must be ISO dates, newest first (spec §9). One
 * leading `#` title is allowed; every other heading must be a `##` date.
 */
function checkLog(body: string, rel: string, out: Diagnostic[]): void {
  const tokens = marked.lexer(body);
  const dates: string[] = [];
  let titleSeen = false;
  for (const t of tokens) {
    if (t.type !== "heading") continue;
    const depth = (t as { depth?: number }).depth;
    const text = String((t as { text?: unknown }).text ?? "").trim();
    if (!titleSeen && depth === 1 && !LOG_DATE_RE.test(text)) {
      titleSeen = true;
      continue;
    }
    if (depth !== 2 || !LOG_DATE_RE.test(text)) {
      out.push({
        level: "error",
        kind: "log-date-format",
        path: rel,
        message:
          depth === 2
            ? `log heading is not a YYYY-MM-DD date: ${terminalSafe(text)}`
            : `log date heading must be \`##\` level (spec §9): ${terminalSafe(text)}`,
      });
      continue;
    }
    dates.push(text);
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i]! > dates[i - 1]!) {
      out.push({
        level: "warning",
        kind: "log-date-order",
        path: rel,
        message: "log entries are not newest-first (spec §9)",
      });
      break;
    }
  }
}

/**
 * Which OKF version to validate against (spec §12): the declared
 * `okf_version` when supported, else the newest supported version with a
 * warning. Undeclared bundles validate silently against the newest.
 */
async function resolveVersion(
  root: string,
  files: string[],
  out: Diagnostic[]
): Promise<string> {
  const fallback = SUPPORTED_VERSIONS[0];
  const rootIndex = files.find((f) => f.toLowerCase() === "index.md");
  if (!rootIndex) return fallback;

  const abs = path.join(root, rootIndex);
  // Skip version sniffing on oversized files; the main loop still reports
  // file-too-large for them.
  if ((await stat(abs)).size > MAX_DOC_BYTES) return fallback;
  const { frontmatter } = splitFrontmatter(await readFile(abs, "utf8"));
  const version = frontmatter.okf_version;
  if (version === undefined) return fallback;

  if (typeof version !== "string") {
    out.push({
      level: "warning",
      kind: "okf-version-format",
      path: rootIndex,
      message: `okf_version should be a quoted string, not ${typeof version} (spec §12)`,
    });
    return fallback;
  }
  if (!(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    out.push({
      level: "warning",
      kind: "okf-version-unsupported",
      path: rootIndex,
      message: `unknown okf_version ${terminalSafe(version)}; validating as ${fallback} (best-effort)`,
    });
    return fallback;
  }
  return version;
}

/** Drop repeated findings with the same (path, kind, target). */
function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const key = `${d.path}\0${d.kind}\0${d.target ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Path-valued frontmatter fields that look like bundle paths (spec §6.2). */
function pathFields(frontmatter: Record<string, unknown>): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const push = (name: string, v: unknown) => {
    if (looksLikePath(v)) out.push({ name, value: v });
  };
  push("resource", frontmatter.resource);
  push("computation", frontmatter.computation);
  for (const key of ["executor", "attester"] as const) {
    const v = frontmatter[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      push(`${key}.resource`, (v as Record<string, unknown>).resource);
    }
  }
  if (Array.isArray(frontmatter.sources)) {
    frontmatter.sources.forEach((e, i) => {
      if (e && typeof e === "object" && !Array.isArray(e)) {
        push(`sources[${i}].resource`, (e as Record<string, unknown>).resource);
      }
    });
  }
  return out;
}

/**
 * True when a frontmatter value looks like a bundle path rather than a URI
 * or a scope descriptor (spec §5.1, §6.2).
 */
function looksLikePath(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || URI_SCHEME_RE.test(s) || /\s/.test(s)) return false;
  return s.startsWith("/") || s.startsWith("./") || s.startsWith("../") || s.includes("/") || FILE_EXT_RE.test(s);
}

/**
 * Resolve a field path to a bundle-relative target: `/x` is absolute,
 * anything else is relative to the document's directory (spec §6.2).
 * Null when it escapes the root.
 */
function resolvePath(rel: string, value: string): string | null {
  const target = value.startsWith("/")
    ? path.posix.normalize(value.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(rel), value));
  if (target === ".." || target.startsWith("../")) return null;
  return target;
}

/** True when `p` exists on disk. */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
