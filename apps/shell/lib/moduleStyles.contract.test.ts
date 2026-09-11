import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("app-wide module stylesheet coverage", () => {
  it("scans every module, including new departments, instead of a fixed allowlist", () => {
    const config = readFileSync(resolve(process.cwd(), "tailwind.config.ts"), "utf8");
    expect(config).toContain('"../../modules/*/src/**/*.{ts,tsx}"');
    expect(config).toContain('"../../packages/ui/src/**/*.{ts,tsx}"');
    expect(config).not.toMatch(/\.\.\/\.\.\/modules\/(warehouse|procurement|legal)\/src/);
  });
});
