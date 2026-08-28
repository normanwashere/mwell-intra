import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { buildSeed } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

describe("Request review metadata", () => {
  it("puts items ahead of long purpose text and keeps raw identifiers in collapsed audit details", async () => {
    const data = buildSeed();
    const purpose = "Requested equipment for the department event. ".repeat(20);
    const requestedAt = "2026-08-28T02:30:00.000Z";
    data.departmentStockRequests = [
      {
        id: "117b7ea4-f0bf-430a-a140-f2e1866805d4",
        requestedBy: "9de5d2be-3c6c-414a-a69c-c38d4fc410a4",
        requestedAt,
        requestingDepartment: "marketing",
        purpose,
        costCenter: "CC-4100",
        requiredDate: "2026-09-01",
        expenseTreatment: "expense",
        status: "pending_approval",
        lines: [{ productId: "smart-watch", quantity: 2 }],
      },
    ];
    renderWithProviders(<FulfillmentPage />, {
      repo: makeRepo(data),
      role: "warehouse_supervisor",
      route: "/fulfillment?tab=requests",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "View request" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review request",
    });
    const table = within(dialog).getByRole("table", {
      name: "Requested items",
    });
    const purposeHeading = within(dialog).getByRole("heading", {
      name: "Purpose",
    });
    expect(
      table.compareDocumentPosition(purposeHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(purposeHeading.nextSibling).toHaveTextContent(purpose.trim());
    expect(within(dialog).getByText("Name unavailable")).toBeVisible();
    expect(
      within(dialog).getByText(
        new Date(requestedAt).toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        new Date("2026-09-01T00:00:00").toLocaleDateString("en-PH", {
          dateStyle: "medium",
        }),
      ),
    ).toBeVisible();
    const audit = within(dialog).getByText("Audit details").closest("details")!;
    expect(audit).not.toHaveAttribute("open");
    expect(
      within(audit).getByText(data.departmentStockRequests[0]!.requestedBy),
    ).not.toBeVisible();
    fireEvent.click(within(dialog).getByText("Audit details"));
    expect(
      within(audit).getByText(data.departmentStockRequests[0]!.requestedBy),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Approve" }),
    ).toBeVisible();
  });

  it("uses the authenticated profile name for the current requester", async () => {
    const data = buildSeed();
    data.departmentStockRequests = [
      {
        id: "request-a",
        requestedBy: "demo-marketing",
        requestedAt: "2026-08-28T02:30:00Z",
        requestingDepartment: "marketing",
        purpose: "Event equipment",
        costCenter: "CC-4100",
        requiredDate: "2026-09-01",
        expenseTreatment: "expense",
        status: "pending_approval",
        lines: [{ productId: "smart-watch", quantity: 2 }],
      },
    ];
    renderWithProviders(<FulfillmentPage />, {
      repo: makeRepo(data),
      role: "marketing",
      route: "/fulfillment?tab=requests",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "View request" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review request",
    });
    expect(within(dialog).getByText("Demo User")).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });
});
