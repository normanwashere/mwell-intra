import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/node_modules.stale-link/**", "**/.next/**", "**/.turbo/**"],
  },
});