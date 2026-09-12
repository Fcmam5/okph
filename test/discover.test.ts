import { describe, it, expect } from "vitest";
import path from "node:path";
import { discover, resolveDocPath } from "../src/discover.js";

const fixtures = path.resolve(import.meta.dirname, "fixtures/docs");

describe("discover", () => {
  it("finds all markdown files recursively as posix relative paths, sorted", async () => {
    const files = await discover(fixtures);
    expect(files).toEqual(["a.md", "nested/b.md"]);
  });
});

describe("resolveDocPath", () => {
  it("resolves in-root targets to posix relative paths", () => {
    expect(resolveDocPath(fixtures, "a.md")).toBe("a.md");
    expect(resolveDocPath(fixtures, "nested/b.md")).toBe("nested/b.md");
    expect(resolveDocPath(fixtures, "nested/../a.md")).toBe("a.md");
  });

  it("returns null for targets outside or equal to root", () => {
    expect(resolveDocPath(fixtures, "../outside.md")).toBeNull();
    expect(resolveDocPath(fixtures, ".")).toBeNull();
    expect(resolveDocPath(fixtures, "/abs/path.md")).toBeNull();
  });
});
