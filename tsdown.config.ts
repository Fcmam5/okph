import { defineConfig } from "tsdown";

/**
 * Build the public API (`src/index.ts`) and the CLI (`bin/okph.ts`) into
 * a clean `dist/` bundle for Node.js 24.
 */
export default defineConfig({
  entry: ["src/index.ts", "bin/okph.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24",
  dts: true,
  clean: true,
});
