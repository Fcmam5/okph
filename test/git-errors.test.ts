import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";

const failWith = vi.hoisted(() => ({ err: undefined as unknown }));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (err: unknown) => void;
    callback(failWith.err);
  },
}));

import { changedMarkdownFiles } from "../src/git.js";

describe("changedMarkdownFiles error wrapping", () => {
  beforeEach(() => {
    failWith.err = undefined;
  });

  it("surfaces git's own last stderr line", async () => {
    failWith.err = Object.assign(new Error("x"), { stderr: "warning: noise\nfatal: bad revision 'zzz'\n" });
    await expect(changedMarkdownFiles("zzz", tmpdir())).rejects.toThrow("git: fatal: bad revision 'zzz'");
  });

  it("falls back to a generic message when stderr is empty", async () => {
    failWith.err = Object.assign(new Error("spawn git ENOENT"), { stderr: "" });
    await expect(changedMarkdownFiles("HEAD", tmpdir())).rejects.toThrow("git command failed");
  });

  it("falls back to a generic message when the error carries no stderr", async () => {
    failWith.err = new Error("spawn git ENOENT");
    await expect(changedMarkdownFiles("HEAD", tmpdir())).rejects.toThrow("git command failed");
    failWith.err = "boom";
    await expect(changedMarkdownFiles("HEAD", tmpdir())).rejects.toThrow("git command failed");
    failWith.err = { stderr: 42 };
    await expect(changedMarkdownFiles("HEAD", tmpdir())).rejects.toThrow("git command failed");
  });

  it("keeps the original error as the cause", async () => {
    failWith.err = new Error("original");
    const err = await changedMarkdownFiles("HEAD", tmpdir()).catch((e: unknown) => e);
    expect((err as Error).cause).toBe(failWith.err);
  });

  it("rejects a base that starts with a dash before running git", async () => {
    await expect(changedMarkdownFiles("--output=x", tmpdir())).rejects.toThrow(/Invalid git base/);
  });
});
