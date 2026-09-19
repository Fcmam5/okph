import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validate } from "../src/validate.js";

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
