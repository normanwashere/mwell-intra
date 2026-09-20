import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import DashboardPage from "../app/page";

vi.mock("@intra/auth", () => ({
  useSession: () => ({
    profile: { id: "operator", name: "Operator", kind: "employee" },
    userRoles: { core: ["staff"], warehouse: ["warehouse_operator"] },
    userCapabilities: {},
    loading: false,
    mode: "memory",
  }),
}));
vi.mock("../lib/moduleBadges", () => ({ useModuleBadges: () => ({}) }));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@intra/learning", () => ({
  OnboardingStatusBand: () => (
    <section aria-label="Role readiness">Readiness</section>
  ),
}));
vi.mock("./knowledge/TaskStartLoader", () => ({
  TaskStartLoader: () => (
    <section aria-label="Operational tasks">Tasks</section>
  ),
}));

it("places work before readiness and retains role-scoped workspace links", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<DashboardPage />);
  expect(html.indexOf("Operational tasks")).toBeLessThan(
    html.indexOf("Role readiness"),
  );
  expect(html).toContain('href="/work"');
  expect(html).toContain('href="/warehouse"');
  expect(html).not.toContain('href="/admin/users"');
  vi.unstubAllGlobals();
});
