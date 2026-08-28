import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.AUDIT_BASE_URL ?? "https://mwell-intra-uat.vercel.app";
if (new URL(baseURL).hostname !== "mwell-intra-uat.vercel.app")
  throw new Error("August 27 evidence is UAT-only.");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "aug27-wms-feedback-live.spec.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/aug27-live-results.json" }],
  ],
  use: {
    baseURL,
    serviceWorkers: "allow",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
