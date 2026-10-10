import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { vi } from "vitest";
import { errorLine, isMain, main } from "../bin/okph.js";

const run = promisify(execFile);
const BIN = path.resolve(import.meta.dirname, "../bin/okph.ts");
const ROOT = path.resolve(import.meta.dirname, "..");

/** Spawn the real CLI through tsx so the process-level entrypoint is exercised. */
async function cli(args: string[], cwd = ROOT) {
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", BIN, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe("CLI process entrypoint", () => {
  it("exits 0 and prints usage for --help", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("exits 1 with the usage error for an unknown command", async () => {
    const r = await cli(["nope"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown or missing command: nope");
  });

  it("turns a thrown error into an 'Error:' line and exit 1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "okph-entry-"));
    try {
      await writeFile(path.join(dir, "R.md"), "# no markers\n");
      const r = await cli(["readme", path.join(dir, "R.md")]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^Error: No <!-- okph:start -->/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("isMain", () => {
  const url = pathToFileURL(BIN).href;

  it("is false without an entry or when the entry does not exist", () => {
    expect(isMain(undefined, url)).toBe(false);
    expect(isMain(path.join(ROOT, "definitely-missing.mjs"), url)).toBe(false);
  });

  it("is true for the module itself and false for any other file", () => {
    expect(isMain(BIN, url)).toBe(true);
    expect(isMain(path.join(ROOT, "package.json"), url)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("follows a symlink to the module", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "okph-link-"));
    try {
      const link = path.join(dir, "okph");
      await symlink(BIN, link);
      expect(isMain(link, url)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  const original = process.exitCode;
  afterEach(() => {
    process.exitCode = original;
    vi.restoreAllMocks();
  });

  it("sets the exit code from run", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await main(["--help"]);
    expect(process.exitCode).toBe(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await main(["nope"]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a thrown error on stderr and exits 1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "okph-main-"));
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeFile(path.join(dir, "R.md"), "# no markers\n");
      const prev = process.cwd();
      process.chdir(dir);
      try {
        await main(["readme", "R.md"]);
      } finally {
        process.chdir(prev);
      }
      expect(process.exitCode).toBe(1);
      expect(String(err.mock.calls[0]![0])).toMatch(/^Error: No <!-- okph:start -->/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("errorLine", () => {
  it("stringifies a non-Error value", () => {
    expect(errorLine("plain string")).toBe("Error: plain string\n");
    expect(errorLine(42)).toBe("Error: 42\n");
  });
});
