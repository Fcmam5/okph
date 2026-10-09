import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../bin/okph.js";
import { MAX_DOC_BYTES } from "../src/limits.js";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "okph-cli-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  await writeFile(path.join(repo, "a.md"), "# A\n\n[dep](b.md)\n");
  await writeFile(path.join(repo, "b.md"), "# B\n");
  await mkdir(path.join(repo, "docs"));
  await writeFile(path.join(repo, "docs", "guide.md"), "# Guide\n\n[t](topic.md)\n");
  await writeFile(path.join(repo, "docs", "topic.md"), "# Topic\n");
  // Repo chrome that cites a doc: noise unless --root narrows the scan.
  await writeFile(path.join(repo, "README.md"), "# Readme\n\n[t](docs/topic.md)\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "base");

  // Deletion-only change: b.md removed, a.md still links to it.
  await rm(path.join(repo, "b.md"));
});

afterAll(() => rm(repo, { recursive: true, force: true }));

/** Run the CLI with both streams captured. */
async function capture(argv: string[], at: string) {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const code = await run(argv, at);
    return {
      code,
      stdout: out.mock.calls.map((c) => String(c[0])).join(""),
      stderr: err.mock.calls.map((c) => String(c[0])).join(""),
    };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("run", () => {
  it("does not execute on import", () => {
    // Importing this module already happened; reaching this test means the
    // entrypoint guard prevented a CLI run against vitest's argv.
    expect(true).toBe(true);
  });

  it("affected --git reports dependents of deleted files", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await run(["affected", "--git", "base"], repo);
      expect(code).toBe(0);
      const stdout = out.mock.calls.map((c) => String(c[0])).join("");
      const stderr = err.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("Deleted since base: b.md");
      // a.md links to the deleted b.md, so both appear as affected.
      expect(stdout).toContain("a.md");
      expect(stdout).toContain("b.md");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("--root narrows the scan so repo files outside it are not dependents", async () => {
    const bare = await capture(["dependents", "docs/topic.md"], repo);
    expect(bare.stdout.split("\n").filter(Boolean)).toEqual(["docs/guide.md", "README.md"]);

    const scoped = await capture(["dependents", "docs/topic.md", "--root", "docs"], repo);
    expect(scoped.code).toBe(0);
    expect(scoped.stdout.split("\n").filter(Boolean)).toEqual(["docs/guide.md"]);
  });

  it("--root keeps output relative to the current directory, not the root", async () => {
    const { stdout } = await capture(
      ["affected", "docs/topic.md", "--root", "docs"],
      repo
    );
    expect(stdout.split("\n").filter(Boolean)).toEqual(["docs/guide.md", "docs/topic.md"]);
  });

  it("rejects a target outside --root", async () => {
    const { code, stderr } = await capture(["deps", "a.md", "--root", "docs"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("is not a markdown file inside docs");
  });

  it("rejects a --root that does not exist", async () => {
    const { code, stderr } = await capture(["deps", "a.md", "--root", "nope"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--root does not exist: nope");
  });

  it("rejects a --root that is a file, not a directory", async () => {
    const { code, stderr } = await capture(["deps", "a.md", "--root", "a.md"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--root is not a directory: a.md");
  });

  it("--md prints results as a markdown link list", async () => {
    const { code, stdout } = await capture(
      ["affected", "docs/topic.md", "--root", "docs", "--md"],
      repo
    );
    expect(code).toBe(0);
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "- [Guide](docs/guide.md)",
      "- [Topic](docs/topic.md)",
    ]);
  });

  it("--md angle-wraps hrefs containing parens", async () => {
    await writeFile(path.join(repo, "docs", "a).md"), "# Paren\n\n[t](topic.md)\n");
    const { stdout } = await capture(
      ["affected", "docs/topic.md", "--root", "docs", "--md"],
      repo
    );
    expect(stdout).toContain("- [Paren](<docs/a).md>)");
    await rm(path.join(repo, "docs", "a).md"));
  });

  it("--md honors --base-url with absolute links", async () => {
    const { stdout } = await capture(
      ["affected", "docs/topic.md", "--root", "docs", "--md", "--base-url", "https://gh.com/o/r/blob/main"],
      repo
    );
    expect(stdout).toContain("- [Guide](https://gh.com/o/r/blob/main/docs/guide.md)");
  });

  it("rejects --md on non-doc commands", async () => {
    const { code, stderr } = await capture(["graph", ".", "--md"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--md is only supported by");
  });

  it("--exclude drops matching files from the graph", async () => {
    const { stdout } = await capture(
      ["dependents", "docs/topic.md", "--exclude", "README.md"],
      repo
    );
    expect(stdout.split("\n").filter(Boolean)).toEqual(["docs/guide.md"]);
  });

  it("--exclude supports ** globs", async () => {
    const { stdout } = await capture(
      ["dependents", "docs/topic.md", "--exclude", "**/guide.md"],
      repo
    );
    expect(stdout.split("\n").filter(Boolean)).toEqual(["README.md"]);
  });

  it("--exclude drops a deleted file's stub and exits clean when nothing remains", async () => {
    const { code, stdout, stderr } = await capture(
      ["affected", "--git", "base", "--exclude", "b.md"],
      repo
    );
    expect(code).toBe(0);
    expect(stdout).not.toContain("b.md");
    expect(stdout).not.toContain("Potentially affected");
    expect(stderr).toContain("or all were excluded");
  });

  it("rejects --exclude on non-doc commands", async () => {
    const { code, stderr } = await capture(["validate", ".", "--exclude", "*.md"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--exclude is only supported by");
  });

  it("validate --ignore drops the named warning kind", async () => {
    const before = await capture(["validate", "."], repo);
    expect(before.stdout).toContain("[warning] orphan");
    const after = await capture(["validate", ".", "--ignore", "orphan"], repo);
    expect(after.stdout).not.toContain("[warning] orphan");
    expect(after.stdout).toContain("[warning] missing-doc");
  });

  it("validate --ignore is repeatable", async () => {
    const { stdout } = await capture(
      ["validate", ".", "--ignore", "orphan", "--ignore", "missing-doc"],
      repo
    );
    expect(stdout).not.toContain("[warning] orphan");
    expect(stdout).not.toContain("[warning] missing-doc");
  });

  it("validate --ignore rejects unknown and error kinds, listing valid ones", async () => {
    for (const kind of ["no-such-rule", "missing-type"]) {
      const { code, stdout, stderr } = await capture(["validate", ".", "--ignore", kind], repo);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain(`--ignore: '${kind}' is not an ignorable warning`);
      expect(stderr).toContain("prefer-absolute-links");
    }
  });

  it("validate --ignore does not echo control characters", async () => {
    const { stderr } = await capture(["validate", ".", "--ignore", "x\u001b[31my"], repo);
    expect(stderr).not.toContain("\u001b");
  });

  it("validate --ignore truncates a long bad kind in the error", async () => {
    const { stderr } = await capture(["validate", ".", "--ignore", "a".repeat(5000)], repo);
    expect(stderr).toContain(`'${"a".repeat(64)}…'`);
    expect(stderr.length).toBeLessThan(1000);
  });

  it("validate --strict passes when every warning is ignored", async () => {
    // Outside `repo`: untracked files there would become `affected --git` seeds.
    const bundle = await mkdtemp(path.join(tmpdir(), "okph-warn-only-"));
    try {
      await writeFile(path.join(bundle, "index.md"), "# I\n\n* [A](/a.md)\n");
      await writeFile(path.join(bundle, "a.md"), "---\ntype: T\ndescription: d\n---\n[b](b.md)\n");
      await writeFile(path.join(bundle, "b.md"), "---\ntype: T\ndescription: d\n---\n# B\n");
      const strict = await capture(["validate", ".", "--strict"], bundle);
      expect(strict.code).toBe(1);
      expect(strict.stdout).toContain("[warning] prefer-absolute-links");
      expect(strict.stdout).not.toContain("[error]");
      const argv = ["validate", ".", "--strict", "--ignore", "prefer-absolute-links"];
      const { code, stdout, stderr } = await capture(argv, bundle);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("no problems found");
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  });

  it("rejects --ignore on non-validate commands", async () => {
    const { code, stderr } = await capture(["deps", "docs/guide.md", "--ignore", "orphan"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--ignore is only supported by the validate command");
  });

  it("affected --git --graph highlights changed seeds", async () => {
    const { stdout } = await capture(["affected", "--git", "base", "--graph"], repo);
    // b.md was deleted since base — it renders as a stub node with the
    // deleted (red) fill; its dependents stay unstyled.
    expect(stdout).toMatch(/style n_\w+ fill:#ef9a9a/);
    expect(stdout.match(/style n_/g)).toHaveLength(1);
  });

  it("deps --graph highlights the queried document", async () => {
    const { stdout } = await capture(["deps", "docs/topic.md", "--graph"], repo);
    expect(stdout).toContain("graph TD");
    expect(stdout).toMatch(/style n_\w+ fill:/);
  });

  it("rejects --root on the graph command", async () => {
    const { code, stderr } = await capture(["graph", ".", "--root", "docs"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--root is only supported by");
  });
});

describe("validate --git", () => {
  let bundle: string;
  const bgit = (...args: string[]) => execFileSync("git", args, { cwd: bundle });
  const fm = (extra = "") => `---\ntype: T\ndescription: d\n${extra}---\n`;
  const put = (name: string, content: string) => writeFile(path.join(bundle, name), content);

  beforeAll(async () => {
    bundle = await mkdtemp(path.join(tmpdir(), "okph-vgit-"));
    bgit("init", "-q");
    bgit("config", "user.email", "t@t.t");
    bgit("config", "user.name", "t");
    await put("index.md", "# I\n\n* [A](/a.md)\n* [B](/b.md)\n* [C](/c.md)\n* [E](/e.md)\n");
    await put("a.md", `${fm()}# A\n`);
    await put("b.md", `${fm()}[a](/a.md)\n`);
    await put("c.md", "---\ntype: T\n---\n# C\n");
    await put("e.md", "---\ndescription: d\n---\n# E\n");
    bgit("add", ".");
    bgit("commit", "-qm", "base");
    bgit("tag", "base");
  });

  afterAll(() => rm(bundle, { recursive: true, force: true }));

  const reset = () => bgit("reset", "-q", "--hard", "base");

  it("scopes warnings to changed docs, keeps errors bundle-wide, and says so", async () => {
    await put("a.md", `${fm()}[x](/nope.md)\n`);
    try {
      const { code, stdout, stderr } = await capture(["validate", ".", "--git", "base"], bundle);
      expect(code).toBe(1);
      expect(stdout).toContain("a.md -> nope.md  [warning] missing-doc");
      expect(stdout).not.toContain("c.md  [warning] recommended-description");
      expect(stdout).toContain("e.md  [error] missing-type");
      expect(stderr).toContain("Scoped to");
      expect(stderr).toContain("warnings only; errors cover the whole bundle");
    } finally {
      reset();
    }
  });

  it("surfaces warnings in dependents of a deleted doc", async () => {
    await rm(path.join(bundle, "a.md"));
    try {
      const { stdout } = await capture(["validate", ".", "--git", "base"], bundle);
      expect(stdout).toContain("b.md -> a.md  [warning] missing-doc");
    } finally {
      reset();
    }
  });

  it("surfaces broken links in index.md when a linked doc is deleted", async () => {
    await rm(path.join(bundle, "a.md"));
    try {
      const { stdout } = await capture(["validate", ".", "--git", "base"], bundle);
      expect(stdout).toContain("index.md -> a.md  [warning] missing-doc");
    } finally {
      reset();
    }
  });

  it("reports an oversized file as an error instead of crashing", async () => {
    const big = path.join(bundle, "big.md");
    await writeFile(big, "x".repeat(MAX_DOC_BYTES + 1));
    try {
      const { code, stdout, stderr } = await capture(["validate", ".", "--git", "base"], bundle);
      expect(code).toBe(1);
      expect(stdout).toContain("big.md  [error] file-too-large");
      expect(stderr).toContain("validating the whole bundle");
    } finally {
      await rm(big, { force: true });
    }
  });

  it("keeps orphan warnings bundle-wide", async () => {
    await put("index.md", "# I\n\n* [A](/a.md)\n* [B](/b.md)\n* [E](/e.md)\n");
    try {
      const { stdout } = await capture(["validate", ".", "--git", "base"], bundle);
      expect(stdout).toContain("c.md  [warning] orphan");
    } finally {
      reset();
    }
  });

  it("still reports an error with nothing changed", async () => {
    const { code, stdout, stderr } = await capture(["validate", ".", "--git", "base"], bundle);
    expect(code).toBe(1);
    expect(stdout).toContain("e.md  [error] missing-type");
    expect(stderr).toContain("Scoped to 0 of");
  });

  it("fails closed on an unknown base", async () => {
    await expect(capture(["validate", ".", "--git", "no-such-rev"], bundle)).rejects.toThrow(
      /git:/
    );
  });

  it("rejects a base that looks like a flag", async () => {
    await expect(capture(["validate", ".", "--git=--output=x"], bundle)).rejects.toThrow(
      /Invalid git base/
    );
  });

  it("rejects --git on commands other than affected and validate", async () => {
    const { code, stderr } = await capture(["deps", "a.md", "--git", "base"], bundle);
    expect(code).toBe(1);
    expect(stderr).toContain("--git is only supported by the affected and validate commands");
  });

  it("--strict fails on a scoped warning but not on an out-of-scope one", async () => {
    // e.md has a bundle-wide error at base, so fix it for this test to keep
    // the exit code driven by warnings only.
    await put("e.md", "---\ntype: T\ndescription: d\n---\n# E\n");
    const { code } = await capture(["validate", ".", "--git", "base", "--strict"], bundle);
    expect(code).toBe(0); // c.md's description warning is out of scope.
    try {
      await put("a.md", `${fm()}[x](/nope.md)\n`);
      const changed = await capture(["validate", ".", "--git", "base", "--strict"], bundle);
      expect(changed.code).toBe(1);
      expect(changed.stdout).toContain("a.md -> nope.md  [warning] missing-doc");
    } finally {
      reset();
    }
  });

  it("scopes by paths relative to a subdirectory bundle root", async () => {
    const sub = await mkdtemp(path.join(tmpdir(), "okph-vgit-sub-"));
    try {
      const sgit = (...a: string[]) => execFileSync("git", a, { cwd: sub });
      sgit("init", "-q");
      sgit("config", "user.email", "t@t.t");
      sgit("config", "user.name", "t");
      await mkdir(path.join(sub, "docs"));
      const sput = (n: string, c: string) => writeFile(path.join(sub, "docs", n), c);
      await sput("index.md", "# I\n\n* [A](/a.md)\n* [O](/orphan.md)\n");
      await sput("a.md", `${fm()}# A\n`);
      await sput("c.md", "---\ntype: T\n---\n# C\n");
      await sput("orphan.md", `${fm()}# O\n`);
      await writeFile(path.join(sub, "README.md"), "# R\n\n[no](/nothing.md)\n");
      sgit("add", ".");
      sgit("commit", "-qm", "base");
      sgit("tag", "base");
      // README's new broken link is outside the bundle; index.md's change is in.
      await sput("index.md", "# I\n\n* [A](/a.md)\n");
      const { code, stdout, stderr } = await capture(
        ["validate", "docs", "--git", "base"],
        sub
      );
      expect(code).toBe(0);
      expect(stdout).not.toContain("nothing.md");
      expect(stdout).not.toContain("recommended-description");
      expect(stdout).toContain("orphan.md  [warning] orphan");
      expect(stderr).toContain("Scoped to 1 of 4 docs");
      // An untracked doc inside the bundle joins the scope.
      await sput("new.md", `${fm()}[gone](/x/gone.md)\n`);
      const again = await capture(["validate", "docs", "--git", "base"], sub);
      expect(again.stdout).toContain("new.md -> x/gone.md  [warning] missing-doc");
    } finally {
      await rm(sub, { recursive: true, force: true });
    }
  });

  it("fails closed outside a git repository", async () => {
    const bare = await mkdtemp(path.join(tmpdir(), "okph-vgit-bare-"));
    try {
      await writeFile(path.join(bare, "a.md"), `${fm()}# A\n`);
      await expect(capture(["validate", ".", "--git", "HEAD"], bare)).rejects.toThrow(/git:/);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
