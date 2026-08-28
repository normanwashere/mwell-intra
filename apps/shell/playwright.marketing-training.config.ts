import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.AUDIT_BASE_URL ?? "https://mwell-intra-uat.vercel.app";
if (new URL(baseURL).origin !== "https://mwell-intra-uat.vercel.app") {
  throw new Error(
    "Marketing training evidence is restricted to the UAT deployment.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "marketing-reservation-training-live.spec.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  outputDir: "artifacts/marketing-reservation-training",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "artifacts/marketing-reservation-training-results.json" },
    ],
  ],
  use: {
    baseURL,
    serviceWorkers: "allow",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    // Login credentials and submitted assessment answers must not enter traces.
    trace: "off",
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
