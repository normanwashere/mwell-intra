import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { WarehouseSessionValue } from "@/auth/session";
import { renderWithProviders } from "@/test/renderWithProviders";
import { prepareWarehouseExport } from "@/app/governedExports";
import { downloadText, downloadUrl } from "@/app/download";
import { DashboardPage } from "./DashboardPage";
import { DataPage } from "./DataPage";
import { ReportsPage } from "./ReportsPage";
import { warehouseModule } from "@intra/rbac";
import { canOpenWarehouseRoute } from "@/app/authorization";

let sessionOverrides: Partial<WarehouseSessionValue>;
const operatorCaps = warehouseModule.roles.warehouse_operator.capabilities;
const combinedCaps = [...new Set([...operatorCaps, ...warehouseModule.roles.operations.capabilities])];
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return { ...actual, useSession: () => ({ ...actual.useSession(), ...sessionOverrides }) };
});
vi.mock("@/app/governedExports", () => ({ prepareWarehouseExport: vi.fn() }));
vi.mock("@/app/download", () => ({ downloadText: vi.fn(), downloadUrl: vi.fn() }));

function RefreshableDashboard() {
  const [, refresh] = useState(0);
  return <><button onClick={() => refresh(n => n + 1)}>Refresh session</button><DashboardPage /></>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOverrides = { mode: "supabase", loading: false, userCapabilities: {} };
  vi.mocked(prepareWarehouseExport).mockResolvedValue({ filename: "inventory.csv", downloadUrl: "https://example.invalid/private-export" });
});

describe("Dashboard export authority", () => {
  it("combined Ops Associate gets the existing sheet on the floor without report-route widening", async () => {
    sessionOverrides.userRoles = { warehouse: ["warehouse_operator", "operations"] };
    sessionOverrides.userCapabilities = { warehouse: combinedCaps };
    expect(canOpenWarehouseRoute("reports", cap => combinedCaps.includes(cap))).toBe(false);
    expect(canOpenWarehouseRoute("data", cap => combinedCaps.includes(cap))).toBe(false);
    renderWithProviders(<DashboardPage />, { role: "warehouse_operator", source: "supabase", capabilities: combinedCaps });
    await screen.findByRole("heading", { name: "Warehouse floor operations" });
    fireEvent.click(screen.getByRole("button", { name: "Export data" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Inventory snapshot" }));
    await waitFor(() => expect(prepareWarehouseExport).toHaveBeenCalledExactlyOnceWith({ source: "supabase", kind: "inventory", demoContent: expect.any(String) }));
  });

  it("combined floor capabilities without effective export authority retain work but no export entry", async () => {
    sessionOverrides.userRoles = { warehouse: ["warehouse_operator", "operations"] };
    sessionOverrides.roleCapabilities = { warehouse: combinedCaps };
    sessionOverrides.userCapabilities = { warehouse: operatorCaps };
    renderWithProviders(<DashboardPage />, { role: "warehouse_operator", source: "supabase", capabilities: operatorCaps });
    await screen.findByRole("heading", { name: "Warehouse floor operations" });
    expect(screen.getByRole("link", { name: "Pick & Pack" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export data" })).not.toBeInTheDocument();
  });
  it.each(["view_analytics", "view_finance"] as const)("%s alone cannot prepare a live export", async capability => {
    sessionOverrides.userCapabilities = { warehouse: [capability] };
    renderWithProviders(<DashboardPage />, { source: "supabase", capabilities: ["view_dashboard", capability] });
    await screen.findByTestId("warehouse-dashboard-hero");
    expect(screen.queryByRole("button", { name: "Export data" })).not.toBeInTheDocument();
    expect(prepareWarehouseExport).not.toHaveBeenCalled();
  });

  it.each([
    { warehouse: ["register_exports"] },
    { insights: ["prepare_exports"] },
  ])("allows the exact effective cross-module alternative %j without analytics/finance", async userCapabilities => {
    sessionOverrides.userCapabilities = userCapabilities;
    renderWithProviders(<DashboardPage />, { source: "supabase", capabilities: ["view_dashboard"] });
    expect(await screen.findByRole("button", { name: "Export data" })).toBeEnabled();
  });

  it.each([
    { userCapabilities: undefined },
    { userCapabilities: {}, roleCapabilities: { warehouse: ["register_exports"], insights: ["prepare_exports"] }, userRoles: { warehouse: ["warehouse_admin"] } },
    { userCapabilities: { warehouse: ["review_exports", "prepare_exports"] } },
    { userCapabilities: { warehouse: ["register_exports"] }, loading: true },
    { userCapabilities: { warehouse: ["register_exports"] }, profile: null },
  ] satisfies Partial<WarehouseSessionValue>[])("fails closed for raw-only, missing, wrong-scope or unrestored authority: %j", async override => {
    sessionOverrides = { ...sessionOverrides, ...override };
    renderWithProviders(<DashboardPage />, { source: "supabase", capabilities: ["view_dashboard", "view_analytics"] });
    await screen.findByTestId("warehouse-dashboard-hero");
    expect(screen.queryByRole("button", { name: "Export data" })).not.toBeInTheDocument();
  });

  it.each([
    ["Inventory snapshot", "inventory"], ["Movement ledger", "movements"], ["Allocations", "allocations"],
  ] as const)("preserves governed %s preparation and download", async (label, kind) => {
    sessionOverrides.userCapabilities = { insights: ["prepare_exports"] };
    renderWithProviders(<DashboardPage />, { source: "supabase", capabilities: ["view_dashboard"] });
    fireEvent.click(await screen.findByRole("button", { name: "Export data" }));
    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() => expect(prepareWarehouseExport).toHaveBeenCalledExactlyOnceWith({ source: "supabase", kind, demoContent: expect.any(String) }));
    expect(downloadUrl).toHaveBeenCalledWith("inventory.csv", "https://example.invalid/private-export");
    expect(downloadText).not.toHaveBeenCalled();
  });

  it.each([false, true])("disables all actions in an already open sheet when effective authority is revoked (floor %s)", async floor => {
    sessionOverrides.userCapabilities = { warehouse: ["register_exports"] };
    renderWithProviders(<RefreshableDashboard />, { source: "supabase", capabilities: floor ? combinedCaps : ["view_dashboard", "view_analytics"] });
    fireEvent.click(await screen.findByRole("button", { name: "Export data" }));
    await screen.findByRole("button", { name: "Inventory snapshot" });
    sessionOverrides.userCapabilities = {};
    // Refresh outside the modal through the harness, preserving its open state.
    fireEvent.click(screen.getByText("Refresh session"));
    for (const name of ["Inventory snapshot", "Movement ledger", "Allocations"]) {
      const action = screen.getByRole("button", { name });
      expect(action).toBeDisabled();
      fireEvent.click(action);
    }
    expect(prepareWarehouseExport).not.toHaveBeenCalled();
    expect(downloadUrl).not.toHaveBeenCalled();
    expect(downloadText).not.toHaveBeenCalled();
  });

  it("preserves local demo export behavior without live grants", async () => {
    sessionOverrides = {};
    vi.mocked(prepareWarehouseExport).mockResolvedValue({ filename: "demo.csv", demoContent: "demo bytes" });
    renderWithProviders(<DashboardPage />, { source: "memory", role: "finance" });
    fireEvent.click(await screen.findByRole("button", { name: "Export data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Inventory snapshot" }));
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith("demo.csv", "demo bytes"));
    expect(prepareWarehouseExport).toHaveBeenCalledWith({ source: "memory", kind: "inventory", demoContent: expect.any(String) });
    expect(downloadUrl).not.toHaveBeenCalled();
  });
});

describe.each([
  ["data", DataPage, ["Inventory", "Movements", "Allocations", "Inventory position", "Quality", "Cycle counts"]],
  ["reports", ReportsPage, ["Export report"]],
] as const)("%s reporting export authority", (_page, Page, labels) => {
  it.each([{}, { warehouse: ["view_analytics", "view_finance", "review_exports"] }, { warehouse: ["prepare_exports"] }])(
    "reporting read-only authority does not authorize export: %j", async userCapabilities => {
      sessionOverrides.userCapabilities = userCapabilities;
      sessionOverrides.roleCapabilities = { warehouse: ["register_exports"], insights: ["prepare_exports"] };
      renderWithProviders(<Page />, { source: "supabase", capabilities: ["view_dashboard", "view_analytics"] });
      await screen.findByRole("button", { name: labels[0] });
      if (Page === ReportsPage) {
        await screen.findByRole("columnheader", { name: "Committed" });
        fireEvent.change(screen.getByLabelText("Location filter"), { target: { value: "loc-cebu" } });
        expect(screen.getByLabelText("Location filter")).toHaveValue("loc-cebu");
      } else expect(screen.getByLabelText("Data dictionary")).toBeInTheDocument();
      for (const name of labels) { const button = screen.getByRole("button", { name }); expect(button).toBeDisabled(); fireEvent.click(button); }
      expect(prepareWarehouseExport).not.toHaveBeenCalled();
    },
  );

  it.each([{ warehouse: ["register_exports"] }, { insights: ["prepare_exports"] }])("reporting accepts either effective grant: %j", async userCapabilities => {
    sessionOverrides.userCapabilities = userCapabilities;
    renderWithProviders(<Page />, { source: "supabase", capabilities: ["view_analytics"] });
    const button = await screen.findByRole("button", { name: labels[0] });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(prepareWarehouseExport).toHaveBeenCalledExactlyOnceWith({ source: "supabase", kind: Page === ReportsPage ? "inventory_position" : "inventory", demoContent: expect.any(String) }));
    expect(downloadUrl).toHaveBeenCalled();
  });

  it("reporting revocation disables previously authorized actions", async () => {
    sessionOverrides.userCapabilities = { insights: ["prepare_exports"] };
    function RefreshablePage() {
      const [, refresh] = useState(0);
      return <><button onClick={() => refresh(n => n + 1)}>Refresh session</button><Page /></>;
    }
    renderWithProviders(<RefreshablePage />, { source: "supabase", capabilities: ["view_analytics"] });
    await screen.findByRole("button", { name: labels[0] });
    await waitFor(() => expect(screen.getByRole("button", { name: labels[0] })).toBeEnabled());
    sessionOverrides.userCapabilities = {};
    fireEvent.click(screen.getByText("Refresh session"));
    for (const name of labels) { const button = screen.getByRole("button", { name }); expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(prepareWarehouseExport).not.toHaveBeenCalled();
  });

  it("reporting keeps its local memory export without live authority", async () => {
    sessionOverrides = {};
    vi.mocked(prepareWarehouseExport).mockResolvedValue({ filename: "demo.csv", demoContent: "demo bytes" });
    renderWithProviders(<Page />, { source: "memory", role: "bi_analyst" });
    const button = await screen.findByRole("button", { name: labels[0] });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith("demo.csv", "demo bytes"));
    expect(downloadUrl).not.toHaveBeenCalled();
  });
});
