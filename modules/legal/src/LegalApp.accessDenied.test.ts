import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegalApp } from "./LegalApp";

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
}));

vi.mock("@intra/auth", () => ({
  useSession: () => state.session,
}));

vi.mock("@intra/rbac", () => ({
  can: () => false,
}));

function renderDenied(basename: string, kind: "employee" | "vendor" = "employee") {
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
});
