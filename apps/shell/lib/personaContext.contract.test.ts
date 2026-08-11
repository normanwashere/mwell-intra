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
});
