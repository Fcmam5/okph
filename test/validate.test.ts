import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { validate, WARNING_KINDS } from "../src/validate.js";

let dir: string;

async function tree(files: Record<string, string>): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return dir;
}

const kinds = async (files: Record<string, string>) =>
  (await validate(await tree(files))).diagnostics.map((d) => `${d.level}:${d.kind}`);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "okph-validate-"));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("validate", () => {
  it("reports nothing for a conformant bundle", async () => {
    const result = await validate(
      await tree({
        "index.md": "---\nokf_version: '0.2'\n---\n# Docs\n\n* [A](/a.md) - an a\n",
        "a.md": "---\ntype: T\ndescription: d\n---\n# A\n",
      })
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.version).toBe("0.2");
    expect(result.errorCount).toBe(0);
  });

  it("flags a missing type as an error", async () => {
    const diags = await kinds({ "index.md": "# I\n* [A](/a.md)", "a.md": "---\ntitle: A\n---\n" });
    expect(diags).toContain("error:missing-type");
  });

  it("flags a concept with no frontmatter at all", async () => {
    const diags = await kinds({ "index.md": "# I\n* [A](/a.md)", "a.md": "# A\n" });
    expect(diags).toContain("error:missing-frontmatter");
  });

  it("flags unparseable frontmatter", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\n: bad: [\n---\n# A\n",
    });
    expect(diags).toContain("error:malformed-frontmatter");
  });

  it("flags frontmatter on a non-root index.md", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [S](/sub/index.md)",
      "sub/index.md": "---\ntype: T\n---\n# Sub\n",
    });
    expect(diags).toContain("error:index-frontmatter");
  });

  it("flags extra keys on the root index.md", async () => {
    const diags = await kinds({
      "index.md": "---\nokf_version: '0.2'\ntitle: x\n---\n# I\n",
    });
    expect(diags).toContain("error:index-frontmatter");
  });

  it("flags broken links and escaping links as warnings", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\ntype: T\n---\n[ghost](ghost.md)\n[out](../x.md)\n",
    });
    expect(diags).toContain("warning:missing-doc");
    expect(diags).toContain("warning:escapes-bundle");
    // a broken relative link reports only missing-doc, not the style warning
    const styleWarnings = (await validate(dir)).diagnostics.filter(
      (d) => d.kind === "prefer-absolute-links" && d.path === "a.md"
    );
    expect(styleWarnings).toHaveLength(0);
  });

  it("flags links to missing non-markdown files", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\ntype: T\n---\n[pic](img.png)\n",
    });
    expect(diags).toContain("warning:missing-file");
  });

  it("flags relative links per spec recommendation", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\ntype: T\n---\n[b](b.md)\n",
      "b.md": "---\ntype: T\n---\n",
    });
    expect(diags).toContain("warning:prefer-absolute-links");
  });

  it("drops ignored warning kinds and excludes them from the count", async () => {
    const root = await tree({
      "index.md": "# I\n* [A](/ign-a.md)",
      "ign-a.md": "---\ntype: T\n---\n[b](ign-b.md)\n[ghost](ghost.md)\n",
      "ign-b.md": "---\ntype: T\n---\n",
    });
    const all = await validate(root);
    const result = await validate(root, { ignore: ["prefer-absolute-links"] });
    const kinds = result.diagnostics.map((d) => d.kind);
    expect(kinds).not.toContain("prefer-absolute-links");
    expect(kinds).toContain("missing-doc");
    const dropped = all.diagnostics.filter((d) => d.kind === "prefer-absolute-links").length;
    expect(dropped).toBeGreaterThan(0);
    expect(result.warningCount).toBe(all.warningCount - dropped);
  });

  it("WARNING_KINDS matches every warning kind validate.ts emits", async () => {
    const src = await readFile(new URL("../src/validate.ts", import.meta.url), "utf8");
    const emitted = [...src.matchAll(/level: "warning",\s*kind: "([a-z-]+)"/g)].map((m) => m[1]);
    expect([...WARNING_KINDS].sort()).toEqual([...new Set(emitted)].sort());
  });

  it("never ignores errors", async () => {
    const result = await validate(
      await tree({ "index.md": "# I\n* [A](/ign-e.md)", "ign-e.md": "# A\n" }),
      { ignore: ["missing-frontmatter" as never] }
    );
    expect(result.diagnostics.map((d) => d.kind)).toContain("missing-frontmatter");
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it("flags unreachable documents but not reserved files", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\ntype: T\n---\n",
      "hidden.md": "---\ntype: T\n---\n",
      "log.md": "# Log\n\n## 2026-01-02\n* x\n",
    });
    expect(diags).toContain("warning:orphan");
  });

  it("flags a YAML list frontmatter block as malformed", async () => {
    const diags = await kinds({
      "list-fm.md": "---\n- a\n- b\n---\n# A\n",
    });
    expect(diags).toContain("error:malformed-frontmatter");
  });

  it("flags date headings at the wrong depth in a log", async () => {
    const diags = await kinds({
      "sub/log.md": "# Log\n\n# 2026-01-01\n* x\n",
    });
    expect(diags).toContain("error:log-date-format");
  });

  it("flags bad log dates and out-of-order logs", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [L](/log.md)",
      "log.md": "# Log\n\n## last week\n* x\n\n## 2026-01-01\n* a\n\n## 2026-03-01\n* b\n\n## 2026-02-01\n* c\n",
    });
    expect(diags).toContain("error:log-date-format");
    expect(diags).toContain("warning:log-date-order");
  });

  it("flags sources entries missing resource", async () => {
    const diags = await kinds({
      "index.md": "# I\n* [A](/a.md)",
      "a.md": "---\ntype: T\nsources:\n  - title: no resource\n---\n",
    });
    expect(diags).toContain("warning:missing-source-resource");
  });

  it("flags a sources entry with an empty resource", async () => {
    const diags = await kinds({
      "empty-res.md": "---\ntype: T\nsources:\n  - resource: ''\n---\n",
    });
    expect(diags).toContain("warning:missing-source-resource");
  });

  it("warns on an unknown okf_version and falls back", async () => {
    const result = await validate(
      await tree({
        "index.md": "---\nokf_version: '9.9'\n---\n# I\n",
      })
    );
    expect(result.version).toBe("0.2");
    expect(result.diagnostics.map((d) => d.kind)).toContain("okf-version-unsupported");
  });

  it("flags an invalid status value", async () => {
    const diags = await kinds({
      "bad-status.md": "---\ntype: T\nstatus: maybe\n---\n",
    });
    expect(diags).toContain("warning:invalid-status");
  });

  it("flags tags that are not a string list", async () => {
    const diags = await kinds({
      "bad-tags.md": "---\ntype: T\ntags: sales\n---\n",
    });
    expect(diags).toContain("warning:invalid-tags");
  });

  it("flags generated without a by actor", async () => {
    const diags = await kinds({
      "bad-gen.md": "---\ntype: T\ngenerated: { at: 2026-01-01T00:00:00Z }\n---\n",
    });
    expect(diags).toContain("warning:invalid-generated");
  });

  it("accepts a bare verified mapping but flags missing fields", async () => {
    const diags = await kinds({
      "ok-verified.md":
        "---\ntype: T\nverified: { by: 'human:a', at: 2026-01-01T00:00:00Z }\n---\n",
      "bad-verified.md": "---\ntype: T\nverified:\n  - { by: 'human:a' }\n---\n",
    });
    expect(diags).toContain("warning:invalid-verified");
    expect(
      diags.filter((d) => d === "warning:invalid-verified")
    ).toHaveLength(1);
  });

  it("checks frontmatter paths but skips URLs and scope descriptors", async () => {
    const result = await validate(
      await tree({
        "paths.md":
          "---\ntype: T\nresource: refs/code.py\nexecutor: { resource: refs/gone.py }\nsources:\n  - resource: all queries in project X\n  - resource: https://example.com/x\n---\n",
        "refs/code.py": "print()\n",
      })
    );
    const missing = result.diagnostics.filter(
      (d) => d.kind === "missing-resource" && d.path === "paths.md"
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]!.target).toBe("refs/gone.py");
  });

  it("flags a frontmatter path to a file that does not exist", async () => {
    const diags = await kinds({
      "missing-path.md": "---\ntype: T\nresource: refs/nope.py\n---\n",
    });
    expect(diags).toContain("warning:missing-resource");
  });

  it("flags a frontmatter path escaping the bundle", async () => {
    const diags = await kinds({
      "sub/escape.md": "---\ntype: T\nresource: ../../outside/x.py\n---\n",
    });
    expect(diags).toContain("warning:escapes-bundle");
  });

  it("does not read an oversized index.md for version detection", async () => {
    const result = await validate(
      await tree({
        "index.md": "---\nokf_version: '9.9'\n---\n" + "x".repeat(6 * 1024 * 1024),
      })
    );
    expect(result.version).toBe("0.2");
    const kinds = result.diagnostics.map((d) => d.kind);
    expect(kinds).toContain("file-too-large");
    expect(kinds).not.toContain("okf-version-unsupported");
  });

  it("dedupes identical findings", async () => {
    const result = await validate(
      await tree({
        "index.md": "# I\n* [A](/a.md)",
        "a.md": "---\ntype: T\n---\n[g](g.md)\n[g](g.md)\n[g](g.md)\n",
      })
    );
    expect(
      result.diagnostics.filter((d) => d.kind === "missing-doc" && d.target === "g.md")
    ).toHaveLength(1);
  });
});

describe("validate scope", () => {
  let scopeDir: string;

  beforeAll(async () => {
    scopeDir = await mkdtemp(path.join(tmpdir(), "okph-scope-"));
    await mkdir(path.join(scopeDir), { recursive: true });
    await writeFile(
      path.join(scopeDir, "index.md"),
      "# I\n\n* [A](/a.md)\n* [C](/c.md)\n"
    );
    await writeFile(
      path.join(scopeDir, "a.md"),
      "---\ntype: T\ndescription: d\n---\n[g](/gone.md)\n"
    );
    await writeFile(path.join(scopeDir, "b.md"), "---\ntype: T\ndescription: d\n---\n# B\n");
    await writeFile(path.join(scopeDir, "c.md"), "---\ndescription: d\n---\n# C\n");
  });

  afterAll(() => rm(scopeDir, { recursive: true, force: true }));

  it("filters warnings to scoped docs and keeps every error", async () => {
    const r = await validate(scopeDir, { scope: ["a.md"] });
    const visible = r.diagnostics.map((d) => `${d.level}:${d.kind}:${d.path}`);
    expect(visible).toContain("warning:missing-doc:a.md");
    expect(visible).toContain("error:missing-type:c.md");
    expect(visible).not.toContain("warning:recommended-description:c.md");
    // orphans are bundle-wide: b.md has no incoming links.
    expect(visible).toContain("warning:orphan:b.md");
    expect(r.docCount).toBe(4);
    expect(r.scopedCount).toBe(1);
  });

  it("leaves scopedCount absent without scope, and composes with ignore", async () => {
    const unscoped = await validate(scopeDir);
    expect(unscoped.scopedCount).toBeUndefined();
    const r = await validate(scopeDir, {
      scope: ["a.md"],
      ignore: ["orphan", "missing-doc"],
    });
    expect(r.diagnostics.map((d) => d.kind)).toEqual(["missing-type"]);
    expect(r.warningCount).toBe(0);
  });

  it("an empty scope still reports errors and bundle-wide warnings", async () => {
    const r = await validate(scopeDir, { scope: [] });
    expect(r.errorCount).toBe(1);
    expect(r.diagnostics.every((d) => d.level === "error" || d.kind === "orphan")).toBe(true);
    expect(r.scopedCount).toBe(0);
  });
});

// Creating symlinks needs elevated rights on Windows.
describe.skipIf(process.platform === "win32")("validate symlink containment", () => {
  let outside: string;
  let bundle: string;

  beforeAll(async () => {
    outside = await mkdtemp(path.join(tmpdir(), "okph-outside-"));
    bundle = await mkdtemp(path.join(tmpdir(), "okph-linked-"));
    await writeFile(path.join(outside, "secret.txt"), "s");
    await writeFile(path.join(bundle, "real.txt"), "r");
    await symlink(outside, path.join(bundle, "out"));
    await symlink(path.join(bundle, "real.txt"), path.join(bundle, "inside.txt"));
    await writeFile(path.join(bundle, "index.md"), "# I\n\n* [A](/a.md)\n");
    await writeFile(
      path.join(bundle, "a.md"),
      "---\ntype: T\ndescription: d\nresource: out/secret.txt\n---\n" +
        "[x](/out/secret.txt)\n[y](/out/nope.txt)\n[z](/inside.txt)\n"
    );
  });

  afterAll(async () => {
    await rm(outside, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  });

  it("does not reveal whether files outside the bundle exist via a symlink", async () => {
    const { diagnostics } = await validate(bundle);
    const at = (kind: string, target: string) =>
      diagnostics.some((d) => d.kind === kind && d.target === target);
    // Existing and missing outside targets look the same: both count as missing.
    expect(at("missing-file", "out/secret.txt")).toBe(true);
    expect(at("missing-file", "out/nope.txt")).toBe(true);
    expect(at("missing-resource", "out/secret.txt")).toBe(true);
  });

  it("does not treat a sibling directory sharing the bundle's name prefix as inside it", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "okph-prefix-"));
    try {
      const inner = path.join(parent, "bundle");
      const evil = path.join(parent, "bundle-evil");
      await mkdir(inner);
      await mkdir(evil);
      await writeFile(path.join(evil, "secret.txt"), "s");
      await symlink(evil, path.join(inner, "out"));
      await writeFile(path.join(inner, "index.md"), "# I\n\n* [A](/a.md)\n");
      await writeFile(
        path.join(inner, "a.md"),
        "---\ntype: T\ndescription: d\n---\n[x](/out/secret.txt)\n"
      );
      const { diagnostics } = await validate(inner);
      expect(diagnostics.some((d) => d.kind === "missing-file" && d.target === "out/secret.txt")).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("still accepts a symlink that stays inside the bundle", async () => {
    const { diagnostics } = await validate(bundle);
    expect(diagnostics.some((d) => d.target === "inside.txt")).toBe(false);
  });
});

describe("validate rule coverage", () => {
  const made: string[] = [];
  afterAll(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
  });

  async function fresh(files: Record<string, string>): Promise<string> {
    const d = await mkdtemp(path.join(tmpdir(), "okph-rules-"));
    made.push(d);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(d, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return d;
  }

  const INDEX = "# I\n\n* [A](/a.md)\n";
  const fm = (extra = "") => `---\ntype: T\ndescription: d\n${extra}---\n# A\n`;
  const found = async (files: Record<string, string>) =>
    (await validate(await fresh({ "index.md": INDEX, ...files }))).diagnostics.map(
      (d) => `${d.level}:${d.kind}:${d.path}`
    );

  it("ignores external links", async () => {
    const out = await found({ "a.md": fm().replace("# A", "[x](https://e.x) [m](mailto:a@b.c) [p](//cdn.x/y)") });
    expect(out).toEqual([]);
  });

  it("checks links: missing doc/file, existing file, escaping, relative form", async () => {
    const d = await fresh({
      "index.md": INDEX,
      "a.md": fm().replace(
        "# A",
        "[d](/gone.md) [f](/gone.txt) [ok](/real.txt) [up](../../x.md) [rel](sub/b.md) [abs](/sub/b.md)"
      ),
      "real.txt": "r",
      "sub/b.md": fm().replace("# A", "[back](/a.md)"),
    });
    const { diagnostics } = await validate(d);
    const at = (kind: string, target?: string) =>
      diagnostics.some((x) => x.kind === kind && (target === undefined || x.target === target));
    expect(at("missing-doc", "gone.md")).toBe(true);
    expect(at("missing-file", "gone.txt")).toBe(true);
    expect(at("missing-file", "real.txt")).toBe(false);
    expect(at("escapes-bundle", "../../x.md")).toBe(true);
    expect(at("prefer-absolute-links", "sub/b.md")).toBe(true);
    expect(diagnostics.filter((x) => x.kind === "prefer-absolute-links")).toHaveLength(1);
  });

  it("validates `sources`", async () => {
    const out = await validate(
      await fresh({
        "index.md": INDEX,
        "a.md": fm('sources:\n  - plain\n  - resource: ""\n  - resource: /ok.txt\n'),
        "ok.txt": "x",
      })
    );
    // Two bad entries share (path, kind, target), so dedupe keeps the first.
    const msgs = out.diagnostics.filter((d) => d.kind === "missing-source-resource").map((d) => d.message);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("sources[0]");
    const second = await validate(
      await fresh({ "index.md": INDEX, "a.md": fm('sources:\n  - resource: /ok.txt\n  - resource: ""\n'), "ok.txt": "x" })
    );
    expect(second.diagnostics.map((d) => d.message).join()).toContain("sources[1]");
    expect(await found({ "a.md": fm("sources: nope\n") })).toContain("warning:missing-source-resource:a.md");
  });

  it("validates `tags`", async () => {
    expect(await found({ "a.md": fm("tags: [a, b]\n") })).toEqual([]);
    expect(await found({ "a.md": fm("tags: solo\n") })).toContain("warning:invalid-tags:a.md");
    expect(await found({ "a.md": fm("tags: [a, 1]\n") })).toContain("warning:invalid-tags:a.md");
  });

  it("validates `generated`", async () => {
    expect(await found({ "a.md": fm("generated:\n  by: tool\n") })).toEqual([]);
    for (const bad of ["generated: tool\n", "generated:\n  by: ''\n", "generated: [x]\n", "generated:\n  at: now\n"]) {
      expect(await found({ "a.md": fm(bad) })).toContain("warning:invalid-generated:a.md");
    }
  });

  it("validates `verified`, accepting a bare mapping as a one-element list", async () => {
    expect(await found({ "a.md": fm("verified:\n  by: me\n  at: 2026-01-01\n") })).toEqual([]);
    expect(await found({ "a.md": fm("verified:\n  - by: me\n    at: 2026-01-01\n") })).toEqual([]);
    for (const bad of ["verified: me\n", "verified:\n  by: me\n", "verified:\n  - at: 2026-01-01\n", "verified:\n  - 7\n"]) {
      expect(await found({ "a.md": fm(bad) })).toContain("warning:invalid-verified:a.md");
    }
  });

  it("validates `status`", async () => {
    for (const ok of ["draft", "stable", "deprecated"]) {
      expect(await found({ "a.md": fm(`status: ${ok}\n`) })).toEqual([]);
    }
    expect(await found({ "a.md": fm("status: wip\n") })).toContain("warning:invalid-status:a.md");
    expect(await found({ "a.md": fm("status: 3\n") })).toContain("warning:invalid-status:a.md");
  });

  it("checks path-valued fields against the bundle", async () => {
    const d = await fresh({
      "index.md": INDEX,
      "docs/a.md": fm(
        [
          "resource: ./sibling.txt",
          "computation: ../../escape.py",
          "executor:\n  resource: /tools/run.sh",
          "attester:\n  resource: missing/attest.md",
          "sources:\n  - resource: bare.csv\n  - plain\n  - [x]",
          "",
        ].join("\n")
      ),
      "docs/sibling.txt": "s",
    });
    await writeFile(path.join(d, "index.md"), "# I\n\n* [A](/docs/a.md)\n");
    const { diagnostics } = await validate(d);
    const by = (kind: string) => diagnostics.filter((x) => x.kind === kind).map((x) => x.target);
    expect(by("escapes-bundle")).toEqual(["../../escape.py"]);
    expect(by("missing-resource").sort()).toEqual(["/tools/run.sh", "bare.csv", "missing/attest.md"]);
  });

  it("does not treat URIs, prose, scope names or non-strings as paths", async () => {
    const out = await found({
      "a.md": fm(
        [
          "resource: https://example.com/x.csv",
          "computation: urn:isbn:123",
          "executor:\n  resource: some free text.md",
          "attester:\n  resource: scope-name",
          "",
        ].join("\n")
      ),
    });
    expect(out).toEqual([]);
    expect(await found({ "a.md": fm("sources:\n  - resource: 42\n") })).toContain(
      "warning:missing-source-resource:a.md"
    );
    expect(await found({ "a.md": fm("executor: tool\nattester: [x]\n") })).toEqual([]);
  });

  it("applies the okf_version rules to the root index", async () => {
    const withVersion = (v: string) => ({ "index.md": `---\nokf_version: ${v}\n---\n# I\n\n* [A](/a.md)\n`, "a.md": fm() });
    const run = async (v: string) => (await validate(await fresh(withVersion(v)))).diagnostics.map((d) => d.kind);
    expect(await run("'0.2'")).toEqual([]);
    expect(await run("0.2")).toEqual(["okf-version-format"]);
    expect(await run("'9.9'")).toEqual(["okf-version-unsupported"]);
    const r = await validate(await fresh(withVersion("'9.9'")));
    expect(r.version).toBe("0.2");
  });

  it("flags extra frontmatter on index files and skips concept rules for them", async () => {
    const out = await found({
      "a.md": fm(),
      "index.md": "---\nokf_version: '0.2'\nextra: 1\n---\n# I\n\n* [A](/a.md)\n",
      "sub/index.md": "---\nanything: 1\n---\n# S\n",
    });
    expect(out.filter((x) => x.includes("index-frontmatter")).sort()).toEqual([
      "error:index-frontmatter:index.md",
      "error:index-frontmatter:sub/index.md",
    ]);
  });

  it("requires concept frontmatter, a type, and flags malformed YAML", async () => {
    expect(await found({ "a.md": "# no frontmatter\n" })).toContain("error:missing-frontmatter:a.md");
    expect(await found({ "a.md": "---\ndescription: d\n---\n# A\n" })).toContain("error:missing-type:a.md");
    expect(await found({ "a.md": "---\ntype: '  '\n---\n# A\n" })).toContain("error:missing-type:a.md");
    expect(await found({ "a.md": "---\n[: bad\n---\n# A\n" })).toContain("error:malformed-frontmatter:a.md");
    expect(await found({ "a.md": "---\ntype: T\ndescription: ''\n---\n# A\n" })).toContain(
      "warning:recommended-description:a.md"
    );
  });

  it("reports a missing root index.md once", async () => {
    const r = await validate(await fresh({ "a.md": fm() }));
    expect(r.diagnostics.filter((d) => d.kind === "recommended-index")).toHaveLength(1);
  });

  it("sorts diagnostics by path, kind, then target", async () => {
    const r = await validate(
      await fresh({
        "index.md": INDEX,
        "a.md": fm().replace("# A", "[z](/zz.md) [y](/yy.md)"),
      })
    );
    const keys = r.diagnostics.map((d) => `${d.path}|${d.kind}|${d.target ?? ""}`);
    expect(keys).toEqual([...keys].sort((x, y) => x.localeCompare(y)));
  });
});

describe("validate log.md rules", () => {
  let logDir: string;
  beforeAll(async () => {
    logDir = await mkdtemp(path.join(tmpdir(), "okph-log-"));
  });
  afterAll(() => rm(logDir, { recursive: true, force: true }));

  const logFor = async (body: string) => {
    await writeFile(path.join(logDir, "index.md"), "# I\n");
    await writeFile(path.join(logDir, "log.md"), body);
    return (await validate(logDir)).diagnostics.filter((d) => d.path === "log.md");
  };

  it("accepts a title and newest-first dated headings", async () => {
    expect(await logFor("# Changelog\n\n## 2026-02-01\n\nx\n\n## 2026-01-01\n")).toEqual([]);
  });

  it("allows frontmatter in log.md", async () => {
    expect(await logFor("---\nanything: 1\n---\n## 2026-01-01\n")).toEqual([]);
  });

  it("errors on a non-date ## heading", async () => {
    const out = await logFor("# T\n\n## Monday\n");
    expect(out.map((d) => d.kind)).toEqual(["log-date-format"]);
    expect(out[0]!.message).toContain("not a YYYY-MM-DD date");
  });

  it("errors on a date heading at the wrong level", async () => {
    const out = await logFor("# T\n\n### 2026-01-01\n");
    expect(out.map((d) => d.kind)).toEqual(["log-date-format"]);
    expect(out[0]!.message).toContain("must be `##` level");
  });

  it("errors on a second title, and reports several bad headings as one finding", async () => {
    const out = await logFor("# T\n\n# Another\n\n## Monday\n");
    expect(out.map((d) => `${d.level}:${d.kind}`)).toEqual(["error:log-date-format"]);
  });

  it("errors on a level-1 date heading (a title may not be a date)", async () => {
    const out = await logFor("# 2026-01-01\n");
    expect(out.map((d) => `${d.level}:${d.kind}`)).toEqual(["error:log-date-format"]);
  });

  it("warns once when entries are not newest-first", async () => {
    const out = await logFor("## 2026-01-01\n\n## 2026-02-01\n\n## 2026-03-01\n");
    expect(out.map((d) => d.kind)).toEqual(["log-date-order"]);
  });

  it("sanitizes a hostile heading in the message", async () => {
    const out = await logFor("## x\u001b[31mred\n");
    expect(out[0]!.message).not.toContain("\u001b");
  });
});
