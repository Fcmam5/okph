import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateMermaid } from "../src/index.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "okph-size-"));
  for (let i = 1; i <= 501; i++) {
    const content = `---\ntitle: Doc ${i}\n---\n\n[Doc 1](doc1.md)\n`;
    fs.writeFileSync(path.join(tmpDir, `doc${i}.md`), content);
  }
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("size limit", () => {
  it("throws when a graph exceeds 500 nodes", async () => {
    await expect(generateMermaid(tmpDir)).rejects.toThrow(
      /exceeds the 500 node\/edge limit/
    );
  });

  it("renders anyway with allowLarge", async () => {
    const out = await generateMermaid(tmpDir, { allowLarge: true });
    expect(out).toContain("graph TD");
  });
});
