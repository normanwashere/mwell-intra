import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("shared shell interaction geometry", () => {
  it("uses one mobile navigation clearance for content and focus scrolling", () => {
    const appShell = source("components/AppShell.tsx");
    const styles = source("app/globals.css");

    expect(appShell).toContain('data-shell-content="true"');
    expect(styles).toContain("--shell-mobile-nav-clearance");
    expect(styles).toContain("scroll-margin-bottom");
    expect(appShell).toContain('data-shell-mobile-nav="true"');
  });

  it("prioritizes Department and DOA destinations for mobile governance users", () => {
    const appShell = source("components/AppShell.tsx");

    expect(appShell).toContain('"/admin/departments", "/admin/doa"');
    expect(appShell).toContain("prioritizedMobileEntries");
    expect(appShell).toContain('pathname.startsWith("/admin/departments")');
  });

  it("keeps every command trigger at least 44px high", () => {
    const appShell = source("components/AppShell.tsx");
    const palette = source("components/CommandPalette.tsx");

    expect(appShell).not.toContain('className="flex h-10 w-10');
    expect(appShell).toContain("md:min-h-11");
    expect(palette).toContain('"flex min-h-11 w-full items-center');
  });
});

describe("server-enforced Knowledge Base audience", () => {
  it("authenticates before serializing content into the Knowledge Base page", () => {
    const page = source("app/knowledge/page.tsx");
    const contextApi = source("app/api/knowledge/context/route.ts");

    expect(page).toContain("createSupabaseServerClient");
    expect(page).toContain("knowledgeContentForAudience");
    expect(page).toContain("<KnowledgeBase content={content}");
    expect(contextApi).toContain("client.auth.getUser()");
    expect(contextApi).toContain("knowledgeContentForAudience");
    expect(contextApi).toContain(
      "if (!feature) return NextResponse.json({ guide: null })",
    );
  });
});

describe("account menu keyboard contract", () => {
  it("closes on Escape and restores focus to its trigger", () => {
    const menu = source("components/UserMenu.tsx");

    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain("triggerRef.current?.focus()");
    expect(menu).toContain("pointerdown");
  });
});
