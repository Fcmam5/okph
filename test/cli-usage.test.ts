import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { mdLines, shellArg } from "../bin/okph.js";
import { buildGraph } from "../src/graph.js";
import { capture } from "./helpers.js";

let dir: string;
let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "okph-usage-"));
  await mkdir(path.join(dir, "sub"));
  await writeFile(path.join(dir, "a.md"), "# A\n\n[b](b.md)\n");
  await writeFile(path.join(dir, "b.md"), "# B\n");
  await writeFile(path.join(dir, "notes.txt"), "x");

  repo = await mkdtemp(path.join(tmpdir(), "okph-usage-git-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  await writeFile(path.join(repo, "a.md"), "# A\n\n[b](b.md)\n");
  await writeFile(path.join(repo, "b.md"), "# B\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "base");
  await writeFile(path.join(repo, "b.md"), "# B changed\n");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("help and command errors", () => {
  it("prints usage for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const { code, stdout } = await capture([flag], dir);
      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("okph readme <file.md>");
    }
  });

  it("rejects a missing command", async () => {
    const { code, stderr } = await capture([], dir);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown or missing command: (none)");
    expect(stderr).toContain("Usage:");
  });

  it("rejects an unknown command and does not echo control characters", async () => {
    const { code, stderr } = await capture(["bogus\u001b[31m"], dir);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown or missing command:");
    expect(stderr).not.toContain("\u001b");
  });
});

describe("flag guards", () => {
  const cases: [string[], string][] = [
    [["graph", ".", "--include-nav"], "--include-nav is only supported"],
    [["validate", ".", "--md"], "--md is only supported"],
    [["validate", ".", "--exclude", "x"], "--exclude is only supported"],
    [["readme", "a.md", "--include-nav"], "--include-nav is only supported"],
    [["graph", ".", "--write"], "--write is only supported by the readme command"],
    [["validate", ".", "--check"], "--check is only supported by the readme command"],
  ];
  for (const [argv, message] of cases) {
    it(`rejects ${argv.slice(2).join(" ")} on ${argv[0]}`, async () => {
      const { code, stderr } = await capture(argv, dir);
      expect(code).toBe(1);
      expect(stderr).toContain(message);
    });
  }

  it("rejects an over-long --exclude glob", async () => {
    const { code, stderr } = await capture(["deps", "a.md", "--exclude", "x".repeat(257)], dir);
    expect(code).toBe(1);
    expect(stderr).toContain("--exclude glob exceeds 256 characters");
  });

  it("accepts a 256-character --exclude glob", async () => {
    const { code } = await capture(["deps", "a.md", "--exclude", "x".repeat(256)], dir);
    expect(code).toBe(0);
  });

  it("rejects affected given both a file and --git", async () => {
    const { code, stderr } = await capture(["affected", "a.md", "--git", "base"], repo);
    expect(code).toBe(1);
    expect(stderr).toContain("either <file> or --git, not both");
  });

  it("requires a path for the commands that take one", async () => {
    for (const command of ["deps", "dependents", "affected", "graph", "readme"]) {
      const { code, stderr } = await capture([command], dir);
      expect(code).toBe(1);
      expect(stderr).toContain("Missing <path>");
    }
  });
});

describe("document commands", () => {
  it("names the working directory when a target is outside the default scan root", async () => {
    const { code, stderr } = await capture(["deps", "../outside.md"], path.join(dir, "sub"));
    expect(code).toBe(1);
    expect(stderr).toContain("is not a markdown file inside the working directory");
  });

  it("names --root when a target is outside it, and rejects non-markdown targets", async () => {
    const outside = await capture(["deps", "a.md", "--root", "sub"], dir);
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain("is not a markdown file inside sub");
    const txt = await capture(["deps", "notes.txt"], dir);
    expect(txt.code).toBe(1);
    expect(txt.stderr).toContain("is not a markdown file");
  });

  it("rejects an unknown document and a bad --root", async () => {
    const unknown = await capture(["deps", "ghost.md"], dir);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("not a known document: ghost.md");
    const missing = await capture(["deps", "a.md", "--root", "nope"], dir);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("--root does not exist: nope");
    const file = await capture(["deps", "a.md", "--root", "a.md"], dir);
    expect(file.stderr).toContain("--root is not a directory: a.md");
  });

  it("prints dependencies, dependents and affected documents as lists, graphs and markdown", async () => {
    expect((await capture(["deps", "a.md"], dir)).stdout).toBe("b.md\n");
    expect((await capture(["dependents", "b.md"], dir)).stdout).toBe("a.md\n");
    expect((await capture(["affected", "b.md"], dir)).stdout).toBe("a.md\nb.md\n");
    expect((await capture(["deps", "b.md"], dir)).stdout).toBe("");
    const g = await capture(["dependents", "b.md", "--graph"], dir);
    expect(g.stdout).toMatch(/^graph TD/);
    expect(g.stdout).toMatch(/n_\w+ --> n_\w+/);
    const md = await capture(["dependents", "b.md", "--md"], dir);
    expect(md.stdout).toBe("- [A](a.md)\n");
    const a = await capture(["affected", "b.md", "--graph"], dir);
    expect(a.stdout).toMatch(/style n_\w+ fill:#ffb300/);
  });

  it("reports affected --git without deletions, as a list", async () => {
    const { code, stdout, stderr } = await capture(["affected", "--git", "base"], repo);
    expect(code).toBe(0);
    expect(stderr).not.toContain("Deleted since");
    expect(stdout).toBe("a.md\nb.md\n");
  });
});

describe("validate path argument", () => {
  it("defaults to the working directory", async () => {
    const { stderr } = await capture(["validate"], dir);
    expect(stderr).toContain("OKF 0.2:");
  });

  it("rejects a missing path and a file path", async () => {
    const missing = await capture(["validate", "nope"], dir);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("path does not exist: nope");
    const file = await capture(["validate", "a.md"], dir);
    expect(file.code).toBe(1);
    expect(file.stderr).toContain("path is not a directory: a.md");
  });
});

describe("graph command", () => {
  it("prints a mermaid graph, honoring --base-url and --allow-large", async () => {
    const plain = await capture(["graph", "."], dir);
    expect(plain.code).toBe(0);
    expect(plain.stdout.startsWith("graph TD")).toBe(true);
    expect(plain.stdout.endsWith("\n")).toBe(true);
    const based = await capture(
      ["graph", ".", "--base-url", "https://example.com/docs", "--allow-large"],
      dir
    );
    expect(based.stdout).toContain('"https://example.com/docs/a.md"');
  });
});

describe("readme argument errors", () => {
  it("rejects a bad --root and a non-regular file", async () => {
    await writeFile(path.join(dir, "R.md"), "<!-- okph:start -->\n<!-- okph:end -->\n");
    const badRoot = await capture(["readme", "R.md", "--root", "nope"], dir);
    expect(badRoot.code).toBe(1);
    expect(badRoot.stderr).toContain("--root does not exist: nope");
    await mkdir(path.join(dir, "folder.md"));
    const notFile = await capture(["readme", "folder.md"], dir);
    expect(notFile.code).toBe(1);
    expect(notFile.stderr).toContain("must be a regular file");
  });
});

describe("mdLines", () => {
  const graph = buildGraph([{ path: "a.md", title: "A [x]", links: [] }]);
  const same = (p: string) => p;

  it("falls back to the path for a document that is not in the graph", () => {
    expect(mdLines(graph, ["ghost.md"], same)).toEqual(["- [ghost.md](ghost.md)"]);
  });

  it("strips brackets from labels and wraps hrefs containing parentheses", () => {
    expect(mdLines(graph, ["a.md"], same)).toEqual(["- [A x](a.md)"]);
    expect(mdLines(graph, ["a.md"], () => "dir/a(1).md")).toEqual(["- [A x](<dir/a(1).md>)"]);
  });

  it("emits a plain label when the href cannot be made safe", () => {
    expect(mdLines(graph, ["a.md"], () => 'bad"name.md')).toEqual(["- A x"]);
  });

  it("joins hrefs onto a base url", () => {
    expect(mdLines(graph, ["a.md"], same, "https://example.com/docs")).toEqual([
      "- [A x](https://example.com/docs/a.md)",
    ]);
  });
});

describe("shellArg", () => {
  it("leaves plain paths alone and quotes everything else", () => {
    expect(shellArg("docs/a-b_c.md")).toBe("docs/a-b_c.md");
    expect(shellArg("my notes.md")).toBe("'my notes.md'");
    expect(shellArg("it's.md")).toBe("'it'\\''s.md'");
    expect(shellArg("")).toBe("''");
    expect(shellArg("$(rm -rf x).md")).toBe("'$(rm -rf x).md'");
  });
});
