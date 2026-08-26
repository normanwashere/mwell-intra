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

  it("uses the shared focus-contained modal for the command palette", () => {
    const palette = source("components/CommandPalette.tsx");

    expect(palette).toContain('import { Icon, Modal, type IconName } from "@intra/ui"');
    expect(palette).toContain('<Modal');
    expect(palette).toContain('title="Command palette"');
    expect(palette).not.toContain('role="dialog"');
  });

  it("presents contextual mobile commands as labeled navigation items", () => {
    const appShell = source("components/AppShell.tsx");

    expect(appShell).toContain("MobileActionTab");
    expect(appShell).not.toContain('className="relative -mt-5 grid h-14 w-14');
    expect(appShell).toContain("{action.label}");
  });

  it("keeps long mobile navigation labels on whole-word boundaries", () => {
    const appShell = source("components/AppShell.tsx");

    expect(appShell).toContain("break-normal hyphens-none");
    expect(appShell).not.toContain("leading-tight break-words");
  });

  it("moves one direct destination into More on narrow mobile screens", () => {
    const appShell = source("components/AppShell.tsx");

    expect(appShell).toContain("data-mobile-nav-narrow-overflow=");
    expect(appShell).toContain('"max-[359px]:hidden"');
    expect(appShell).toContain("w-full min-w-0 max-w-full overflow-x-clip");
    expect(appShell).toContain(
      "relative flex w-full min-w-0 max-w-full items-end",
    );
  });

  it("turns prolonged session restoration into a bounded recovery state", () => {
    const appShell = source("components/AppShell.tsx");
    const recovery = source("components/BoundedLoadingState.tsx");

    expect(appShell).toContain("<BoundedLoadingState");
    expect(recovery).toContain("timeoutMs = 8000");
    expect(recovery).toContain("Loading is taking longer than expected");
    expect(recovery).toContain("Recovery owner");
    expect(recovery).toContain("Reload page");
  });

  it("uses the same bounded recovery state while onboarding authority loads", () => {
    const gate = source("components/OnboardingRouteGate.tsx");

    expect(gate).toContain('import { BoundedLoadingState } from "./BoundedLoadingState"');
    expect(gate).toContain('<BoundedLoadingState');
    expect(gate).toContain('label="Checking your onboarding..."');
    expect(gate).toContain('recoveryOwner="Platform Support"');
    expect(gate).not.toContain('checking ? "animate-spin"');
  });

  it("keeps shared shell-facing source free of encoding-sensitive symbols", () => {
    for (const path of [
      "components/AppShell.tsx",
      "components/PersonaContext.tsx",
      "components/ModuleLoadingSkeleton.tsx",
    ]) {
      expect(
        [...source(path)].every((character) => character.codePointAt(0)! <= 127),
        path,
      ).toBe(true);
    }
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

describe("role onboarding integration", () => {
  it("mounts learning once at the authenticated provider boundary", () => {
    const providers = source("app/providers.tsx");

    expect(providers).toContain('import { LearningProvider } from "@intra/learning"');
    expect(providers).toContain("<LearningProvider>");
    expect(providers).toContain("</LearningProvider>");
  });

  it("publishes internal and vendor onboarding as distinct destinations", () => {
    const internalPage = source("app/onboarding/page.tsx");
    const vendorPage = source("app/vendor/onboarding/page.tsx");

    expect(internalPage).toContain("<OnboardingCenter");
    expect(vendorPage).toContain('audience="vendor"');
    expect(vendorPage).toContain("Vendor onboarding");
  });

  it("shows readiness on Home and makes onboarding universal shell navigation", () => {
    const dashboard = source("app/page.tsx");
    const appShell = source("components/AppShell.tsx");
    const palette = source("components/CommandPalette.tsx");

    expect(dashboard).toContain("<OnboardingStatusBand");
    expect(appShell).toContain("shellNavigationAreas");
    expect(palette).toContain("ONBOARDING_NAV");
  });

  it("compiles every learning workspace utility used by the shell", () => {
    const tailwind = source("tailwind.config.ts");

    expect(tailwind).toContain("../../modules/learning/src/**/*.{ts,tsx}");
  });
});
