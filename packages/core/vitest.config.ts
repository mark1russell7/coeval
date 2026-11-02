import { defineConfig } from "vitest/config";
import { ShareReporter } from "./vitest.share.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The reporters of the default config, and the share of the timeout of each test in CI (K207, D96).
    reporters: ["default", ...(process.env["GITHUB_ACTIONS"] === "true" ? ["github-actions"] : []), new ShareReporter()],
  },
});
