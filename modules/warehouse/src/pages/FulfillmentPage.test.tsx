import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

describe("FulfillmentPage", () => {
  it("presents the four cross-department queues and their handoffs", async () => {
    renderWithProviders(<FulfillmentPage />, { role: "operations" });

    expect(
      await screen.findByRole("heading", { name: "Fulfillment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Orders and events" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Department requests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Return cases" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Kits and re-kits" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sales, Operations, or Marketing"),
    ).toBeInTheDocument();
    expect(screen.getByText("Warehouse operator")).toBeInTheDocument();
  });

  it("lets a warehouse operator begin fulfillment without exposing setup controls", async () => {
    const repo = makeRepo();
    await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-2201",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell.com.ph",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });

    const order = await screen.findByRole("listitem", { name: /SHOP-2201/i });
    expect(within(order).getByText("Received")).toBeInTheDocument();
    await user.click(
      within(order).getByRole("button", { name: "Allocate stock" }),
    );

    await waitFor(() => {
      expect(within(order).getByText("Allocated")).toBeInTheDocument();
    });
    expect(
      within(order).getByRole("button", { name: "Start picking" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New fulfillment demand" }),
    ).not.toBeInTheDocument();
  });

  it("lets Operations record third-party event sales demand", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(
      await screen.findByRole("button", { name: "New fulfillment demand" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Create fulfillment demand",
    });
    expect(
      within(dialog).queryByRole("option", { name: "Small Shipping Box" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: "Warehouse Cutter" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Demand source"),
      "third_party",
    );
    await user.type(
      within(dialog).getByLabelText("Order reference"),
      "EVENT-SALE-2201",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Event"),
      "evt-makati",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Third-party inventory location"),
      "loc-event-makati",
    );
    await user.type(within(dialog).getByLabelText("Gross sales (PHP)"), "8640");
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "smart-watch",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create demand" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).fulfillmentOrders).toEqual([
        expect.objectContaining({
          source: "third_party",
          eventId: "evt-makati",
          grossSalesAmount: 8640,
        }),
      ]);
    });
    expect(await screen.findAllByText("PHP 8,640.00")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Allocate stock" }),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("lets Marketing submit a governed department stock request", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "marketing", repo });

    await user.click(
      await screen.findByRole("tab", { name: "Department requests" }),
    );
    await user.click(screen.getByRole("button", { name: "New stock request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Request warehouse stock",
    });
    await user.clear(within(dialog).getByLabelText("Business purpose"));
    await user.type(
      within(dialog).getByLabelText("Business purpose"),
      "Community wellness campaign",
    );
    await user.clear(within(dialog).getByLabelText("Cost center"));
    await user.type(within(dialog).getByLabelText("Cost center"), "MKT-220");
    await user.type(
      within(dialog).getByLabelText("Required date"),
      "2026-08-15",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );
    const quantity = within(dialog).getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "8");
    await user.click(
      within(dialog).getByRole("button", { name: "Submit request" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).departmentStockRequests).toEqual([
        expect.objectContaining({
          requestingDepartment: "marketing",
          purpose: "Community wellness campaign",
          status: "pending_approval",
        }),
      ]);
    });
    expect(
      await screen.findByText("Community wellness campaign"),
    ).toBeInTheDocument();
  });

  it("forces merchandise requests to expense treatment", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "marketing" });

    await user.click(
      await screen.findByRole("tab", { name: "Department requests" }),
    );
    await user.click(screen.getByRole("button", { name: "New stock request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Request warehouse stock",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );

    expect(within(dialog).getByLabelText("Expense treatment")).toHaveValue(
      "expense",
    );
    expect(within(dialog).getByLabelText("Expense treatment")).toBeDisabled();
    expect(
      within(dialog).queryByRole("option", { name: /fulfillment supply/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a customer-service return case and preserves the warehouse handoff", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(await screen.findByRole("tab", { name: "Return cases" }));
    await user.click(screen.getByRole("button", { name: "New return case" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Record customer return",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "smart-watch",
    );
    await user.type(
      within(dialog).getByLabelText("Serial number"),
      "SMART-WATCH-VIP001",
    );
    await user.type(
      within(dialog).getByLabelText("Defect description"),
      "Display does not turn on",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create return case" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).customerReturnCases).toEqual([
        expect.objectContaining({ resolution: "pending", status: "submitted" }),
      ]);
    });
    expect(
      await screen.findByText("Display does not turn on"),
    ).toBeInTheDocument();
    expect(screen.getByText("Customer service")).toBeInTheDocument();
  });

  it("gives Finance a refund-only return action", async () => {
    const repo = makeRepo();
    await repo.createCustomerReturnCase({
      productId: "smart-watch",
      serialNumber: "SMART-WATCH-VIP001",
      defectDescription: "Customer approved refund",
      actor: "customer.service@mwell",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "finance", repo });

    await user.click(await screen.findByRole("tab", { name: "Return cases" }));
    await user.click(screen.getByRole("button", { name: "Record refund" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Record finance refund",
    });
    expect(within(dialog).getByLabelText("Resolution")).toHaveValue("refund");
    expect(within(dialog).getByLabelText("Resolution")).toBeDisabled();
    expect(
      within(dialog).getByLabelText("Finance refund reference"),
    ).toBeRequired();
  });

  it("lets a warehouse supervisor register a Product-owned kit definition", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_supervisor",
      repo,
    });

    await user.click(
      await screen.findByRole("tab", { name: "Kits and re-kits" }),
    );
    expect(screen.getByText("Product department")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "New kit definition" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Define a bundle or kit",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Kit product"),
      "otg-bag",
    );
    await user.type(
      within(dialog).getByLabelText("Definition name"),
      "OTG Standard Set",
    );
    await user.type(
      within(dialog).getByLabelText("Product approval reference"),
      "PROD-GO-LIVE-2201",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Component product"),
      "smart-watch",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save kit definition" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).kitDefinitions).toEqual([
        expect.objectContaining({
          name: "OTG Standard Set",
          ownerDepartment: "product",
          productApprovalReference: "PROD-GO-LIVE-2201",
        }),
      ]);
    });
    expect(await screen.findByText("OTG Standard Set")).toBeInTheDocument();
  });
});
