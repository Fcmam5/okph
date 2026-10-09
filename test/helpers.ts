import { vi } from "vitest";
import { run } from "../bin/okph.js";

/** Run the CLI with both streams captured. */
export async function capture(argv: string[], at: string) {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const code = await run(argv, at);
    return {
      code,
      stdout: out.mock.calls.map((c) => String(c[0])).join(""),
      stderr: err.mock.calls.map((c) => String(c[0])).join(""),
    };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}
