import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_DOC_BYTES } from "../src/index.js";
import { capture } from "./helpers.js";

const hooks = vi.hoisted(() => ({
  afterLstat: undefined as undefined | (() => Promise<void>),
  afterOpen: undefined as undefined | ((handle: import("node:fs/promises").FileHandle) => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      await hooks.afterLstat?.();
      return info;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      await hooks.afterOpen?.(handle);
      return handle;
    },
  };
});

describe("README reads during path replacement", () => {
  let dir: string;
  let file: string;
  const marked = "# Original\n<!-- okph:start -->\n<!-- okph:end -->\n";
  const run = () => capture(["readme", "README.md", "--root", "docs"], dir);

  beforeEach(async () => {
    hooks.afterLstat = undefined;
    hooks.afterOpen = undefined;
    dir = await mkdtemp(path.join(tmpdir(), "okph-readme-race-"));
    file = path.join(dir, "README.md");
    await mkdir(path.join(dir, "docs"));
    await writeFile(file, marked);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("rejects a symlink substituted after lstat", async () => {
    const other = path.join(dir, "other.md");
    await writeFile(other, marked);
    hooks.afterLstat = async () => {
      await rm(file);
      await symlink(other, file);
    };
    await expect(run()).rejects.toMatchObject({ code: "ELOOP" });
  });

  it.each(["oversized", "directory"])("rejects a substituted %s before reading and closes the handle", async (kind) => {
    hooks.afterLstat = async () => {
      await rm(file);
      if (kind === "directory") await mkdir(file);
      else await writeFile(file, "x".repeat(MAX_DOC_BYTES + 1));
    };
    const close = vi.fn();
    const read = vi.fn();
    hooks.afterOpen = async (handle) => {
      const originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => { close(); await originalClose(); });
      vi.spyOn(handle, "readFile").mockImplementation(read);
    };
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(kind === "directory" ? "must be a regular file" : "exceeds");
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reads the opened file when its path is replaced and closes the handle", async () => {
    let handle: import("node:fs/promises").FileHandle | undefined;
    hooks.afterOpen = async (opened) => {
      handle = opened;
      await rename(file, path.join(dir, "original.md"));
      await writeFile(file, marked.replace("Original", "Replacement"));
    };
    const result = await run();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("# Original");
    expect(result.stdout).not.toContain("Replacement");
    expect(handle?.fd).toBe(-1);
  });

  it.each(["stat", "readFile"] as const)("closes the handle when %s fails", async (operation) => {
    let handle: import("node:fs/promises").FileHandle | undefined;
    const error = Object.assign(new Error("read failure"), { code: "EIO" });
    hooks.afterOpen = async (opened) => {
      handle = opened;
      vi.spyOn(opened, operation).mockRejectedValue(error);
    };
    await expect(run()).rejects.toBe(error);
    expect(handle?.fd).toBe(-1);
  });
});
