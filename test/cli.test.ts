import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../bin/okph.js";

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

  it("rejects --root on the graph command", async () => {
    const { code, stderr } = await capture(["graph", ".", "--root", "docs"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("--root is only supported by");
  });
});
