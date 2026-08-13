import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("shell persona context", () => {
  it("presents canonical identity separately from scoped authority", () => {
    const shell = source("components/AppShell.tsx");
    const menu = source("components/UserMenu.tsx");

    expect(shell).toContain("PersonaContext");
    expect(menu).toContain("persona.title");
    expect(menu).toContain("persona.department");
    expect(menu).toContain("Scoped authority");
    expect(menu).toContain("persona.authority");
  });

  it("does not turn visible persona metadata into a competing accessible name", () => {
    const context = source("components/PersonaContext.tsx");

    expect(context).not.toContain('aria-label={`Signed in as');
    expect(context).toContain("persona.department");
  });
});
