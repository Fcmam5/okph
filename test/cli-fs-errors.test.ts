import { describe, it, expect, vi, beforeEach } from "vitest";
import { capture } from "./helpers.js";

const fail = vi.hoisted(() => ({ stat: undefined as unknown, lstat: undefined as unknown }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const guarded =
    (name: "stat" | "lstat") =>
    (...args: Parameters<typeof actual.stat>) =>
      fail[name] === undefined ? actual[name](...args) : Promise.reject(fail[name]);
  return { ...actual, stat: guarded("stat"), lstat: guarded("lstat") };
});

const withCode = (code: string) => Object.assign(new Error("fs"), { code });

describe("filesystem failures are reported, not thrown", () => {
  beforeEach(() => {
    fail.stat = undefined;
    fail.lstat = undefined;
  });

  it("names the error code when --root cannot be read", async () => {
    fail.stat = withCode("EACCES");
    const { code, stderr } = await capture(["deps", "a.md", "--root", "sub"], process.cwd());
    expect(code).toBe(1);
    expect(stderr).toContain("cannot read --root sub: EACCES");
  });

  it("falls back to 'unknown error' when the failure has no code", async () => {
    fail.stat = new Error("odd");
    const { stderr } = await capture(["deps", "a.md", "--root", "sub"], process.cwd());
    expect(stderr).toContain("cannot read --root sub: unknown error");
  });

  it("does the same for the validate path argument", async () => {
    fail.stat = withCode("EIO");
    const { stderr } = await capture(["validate", "somewhere"], process.cwd());
    expect(stderr).toContain("cannot read path somewhere: EIO");
  });

  it("reports an unreadable README with its code, or 'unknown error'", async () => {
    fail.lstat = withCode("EACCES");
    expect((await capture(["readme", "R.md"], process.cwd())).stderr).toContain(
      "cannot read R.md: EACCES"
    );
    fail.lstat = new Error("odd");
    expect((await capture(["readme", "R.md"], process.cwd())).stderr).toContain(
      "cannot read R.md: unknown error"
    );
  });

  it("sanitizes control characters in the echoed path", async () => {
    fail.stat = withCode("EACCES");
    const { stderr } = await capture(["validate", "x\u001b[31m"], process.cwd());
    expect(stderr).not.toContain("\u001b");
  });
});
