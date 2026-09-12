import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedMarkdownFiles } from "../src/git.js";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "okph-git-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await writeFile(path.join(repo, "docs/a.md"), "# A\n");
  await writeFile(path.join(repo, "docs/deleted.md"), "# D\n");
  await writeFile(path.join(repo, "readme.txt"), "not md\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "base");

  // changes relative to the "base" tag:
  await writeFile(path.join(repo, "docs/a.md"), "# A changed\n");
  await writeFile(path.join(repo, "docs/new.md"), "# New\n");
  await writeFile(path.join(repo, "docs/naïve.md"), "# Non-ASCII\n");
  await writeFile(path.join(repo, "readme.txt"), "still not md\n");
  await rm(path.join(repo, "docs/deleted.md"));
});

afterAll(() => rm(repo, { recursive: true, force: true }));

describe("changedMarkdownFiles", () => {
  it("returns changed/new .md files, repo-relative to cwd, excluding deleted and non-md", async () => {
    const { changed, deleted } = await changedMarkdownFiles("base", repo);
    expect(changed).toEqual(["docs/a.md", "docs/naïve.md", "docs/new.md"]);
    expect(deleted).toEqual(["docs/deleted.md"]);
  });
});
