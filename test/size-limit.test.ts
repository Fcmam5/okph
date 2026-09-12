import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateMermaid, loadGraph, MAX_DOC_BYTES } from "../src/index.js";

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
  it("sanitizes an oversized file path while preserving size details", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okph-oversized-"));
    const filename = "safe\u202Ecod.md";
    fs.writeFileSync(path.join(dir, filename), Buffer.alloc(MAX_DOC_BYTES + 1));
    try {
      await expect(loadGraph(dir)).rejects.toThrow(
        `File too large: safe\\u202Ecod.md (${MAX_DOC_BYTES + 1} bytes, limit is ${MAX_DOC_BYTES})`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
