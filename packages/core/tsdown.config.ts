import { defineConfig } from "tsdown";

// The build of the package for npm: one ES module for each entry, and its declarations, in build/. The workspace uses the source.
export default defineConfig({
  entry: ["src/index.ts", "src/layers.ts"],
  outDir: "build",
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  publint: true,
});
