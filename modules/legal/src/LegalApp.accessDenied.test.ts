import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegalApp } from "./LegalApp";

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  capabilities: new Set<string>(),
  selectedRoute: "/cases/:id/application",
}));

vi.mock("@intra/auth", () => ({
  useSession: () => state.session,
  useCan: (module: string, capability: string) =>
    state.capabilities.has(`${module}:${capability}`),
}));

vi.mock("@intra/rbac", () => ({
  can: (_roles: unknown, module: string, capability: string) =>
    state.capabilities.has(`${module}:${capability}`),
}));

vi.mock("@intra/ui", () => ({
  ContextualHelpLink: () => null,
  SignInPrompt: () => "Sign in required",
  SkeletonList: () => "Loading list",
  SkeletonStats: () => "Loading summary",
}));

vi.mock("react-router-dom", () => ({
  BrowserRouter: ({ children }: { children: ReactNode }) => children,
  Navigate: () => null,
  Route: ({
    path,
    element,
  }: {
    path: string;
    element: ReactNode;
  }) => (path === state.selectedRoute ? element : null),
  Routes: ({ children }: { children: ReactNode }) => children,
  useLocation: () => ({ pathname: "/cases/case-1/application", search: "" }),
}));

vi.mock("./pages/AccreditationCasesPage", () => ({
  AccreditationCasesPage: () => "Vendor cases rendered",
}));
vi.mock("./pages/CaseDetailPage", () => ({ CaseDetailPage: () => null }));
vi.mock("./pages/InviteVendorPage", () => ({ InviteVendorPage: () => null }));
vi.mock("./pages/SignInstrumentPage", () => ({ SignInstrumentPage: () => null }));
vi.mock("./pages/VendorApplicationPage", () => ({
  VendorApplicationPage: () => "Vendor application rendered",
}));

function renderDenied(basename: string, kind: "employee" | "vendor" = "employee") {
  state.capabilities.clear();
  state.session = {
    userRoles: {},
    profile: {
      id: "person-1",
      email: "person@mwell.test",
      kind,
      name: "Test Person",
    },
    loading: false,
    signOut: vi.fn(),
    mode: "memory",
    supabaseClient: null,
  };

  return renderToStaticMarkup(createElement(LegalApp, { basename }));
}

describe("LegalApp access-denied recovery", () => {
  beforeEach(() => {
    state.session = {};
    state.capabilities.clear();
    state.selectedRoute = "/cases/:id/application";
  });

  it("does not add a nested main landmark inside the internal shell", () => {
    const html = renderDenied("/legal");

    expect(html).not.toContain("<main");
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to dashboard");
  });

  it("uses vendor-specific denial copy and offers both recovery paths", () => {
    const html = renderDenied("/vendor");

    expect(html).toContain("Vendor portal access required");
    expect(html).not.toContain("No legal access");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to dashboard");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in with a different account");
  });

  it("denies the vendor application route when live draft authority is absent", () => {
    state.capabilities.add("core:view_own_accreditation");
    state.session = {
      userRoles: { core: ["vendor_portal"] },
      userCapabilities: { core: ["view_own_accreditation"] },
      profile: {
        id: "vendor-1",
        email: "vendor@mwell.test",
        kind: "vendor",
        name: "Vendor Person",
      },
      loading: false,
      signOut: vi.fn(),
      mode: "supabase",
      supabaseClient: {},
    };

    const html = renderToStaticMarkup(createElement(LegalApp, { basename: "/vendor" }));

    expect(html).toContain("Accreditation draft access required");
    expect(html).not.toContain("Vendor application rendered");
  });

  it("keeps the read-only vendor case list available without draft authority", () => {
    state.selectedRoute = "/";
    state.capabilities.add("core:view_own_accreditation");
    state.session = {
      userRoles: { core: ["vendor_portal"] },
      userCapabilities: { core: ["view_own_accreditation"] },
      profile: {
        id: "vendor-1",
        email: "vendor@mwell.test",
        kind: "vendor",
        name: "Vendor Person",
      },
      loading: false,
      signOut: vi.fn(),
      mode: "supabase",
      supabaseClient: {},
    };

    const html = renderToStaticMarkup(createElement(LegalApp, { basename: "/vendor" }));

    expect(html).toContain("Vendor cases rendered");
    expect(html).not.toContain("Accreditation draft access required");
  });
});
