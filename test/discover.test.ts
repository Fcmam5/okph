import { describe, it, expect } from "vitest";
import path from "node:path";
import { discover } from "../src/discover.js";

const fixtures = path.resolve(import.meta.dirname, "fixtures/docs");

describe("discover", () => {
  it("finds all markdown files recursively as posix relative paths, sorted", async () => {
    const files = await discover(fixtures);
    expect(files).toEqual(["a.md", "nested/b.md"]);
  });
});
