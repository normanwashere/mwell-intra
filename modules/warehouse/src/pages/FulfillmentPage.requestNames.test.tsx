import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { buildSeed } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

describe("Request-scoped display names", () => {
  it.each(["memory", "supabase"] as const)("shows cross-user names and retains audit identities in %s", async (source) => {
    const data = buildSeed();
    data.departmentStockRequests = [{
      id: "request-name", requestedBy: "requester-uuid", requestedByName: "Marketing Requester",
      approvedBy: "approver-uuid", approvedByName: "Procurement Approver",
      requestedAt: "2026-09-08T03:00:00Z", approvedAt: "2026-09-08T03:01:00Z",
      requestingDepartment: "marketing", purpose: "Test stock", costCenter: "CC-4100",
      requiredDate: "2026-09-08", expenseTreatment: "expense", status: "approved",
      lines: [{ productId: "smart-watch", quantity: 2 }],
    }];
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: "warehouse_supervisor", source, route: "/fulfillment?tab=requests" });
    fireEvent.click(await screen.findByRole("button", { name: "View request" }));
    const dialog = await screen.findByRole("dialog", { name: "Review request" });
    expect(within(dialog).getByText("Marketing Requester")).toBeVisible();
    expect(within(dialog).getByText("Procurement Approver")).toBeVisible();
    fireEvent.click(within(dialog).getByText("Audit details"));
    expect(within(dialog).getByText("requester-uuid")).toBeVisible();
  });
});
