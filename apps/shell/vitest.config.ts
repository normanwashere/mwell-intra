import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shell": path.resolve(__dirname),
      "@": path.resolve(__dirname, "../../modules/warehouse/src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/api/**/*.test.ts",
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "components/**/*.test.tsx",
    ],
    clearMocks: true,
  },
});
