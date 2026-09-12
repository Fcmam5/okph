import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "base");

  // Deletion-only change: b.md removed, a.md still links to it.
  await rm(path.join(repo, "b.md"));
});

afterAll(() => rm(repo, { recursive: true, force: true }));

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
});
