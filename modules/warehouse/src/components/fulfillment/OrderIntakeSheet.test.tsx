import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@intra/data-kit";
import { describe, expect, it, vi } from "vitest";
import { modulesForRole } from "@/app/modules";
import type { Role } from "@/domain/types";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrderIntakeSheet } from "./OrderIntakeSheet";

const product: Product = {
  id: "smart-watch",
  sku: "SMART-WATCH",
  name: "Smart Watch",
  category: "device",
  itemClass: "sellable_sku",
  serialized: false,
  attributes: {},
  unitCost: 2500,
  price: 4320,
  reorderPoint: 5,
};

const warehouse = { id: "loc-wh", name: "Main Warehouse", type: "warehouse" };
const externalLocation = {
  id: "loc-event-makati",
  name: "Makati Event Custody",
  type: "event_site",
};
const events = [{ id: "evt-makati", name: "Makati Wellness Fair" }];

function renderSheet(
  locations: Array<{ id: string; name: string; type?: string }>,
  role: Role = "operations",
) {
  const create = vi.fn().mockResolvedValue(true);
  renderWithProviders(
    <OrderIntakeSheet
      open
      onOpenChange={vi.fn()}
      products={[product]}
      locations={locations}
      events={events}
      create={create}
    />,
    { role },
  );
  return create;
}

async function selectThirdPartySource() {
  const dialog = await screen.findByRole("dialog", {
    name: "Create order or fulfillment demand",
  });
  await userEvent.setup().selectOptions(
    within(dialog).getByLabelText("Demand source"),
    "third_party",
  );
  return dialog;
}

describe("OrderIntakeSheet third-party event intake", () => {
  it("gives Operations a reachable event escalation instead of restricted location management", async () => {
    const create = renderSheet([warehouse]);
    const dialog = await selectThirdPartySource();

    expect(
      within(dialog).getByText(/Marketing owns and approves the event/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Warehouse or Operations administrator controls external custody locations/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Operations records the sale and gross sales/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Finance closes settlement/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", {
        name: "No external custody location exists",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Third-party inventory location"),
    ).not.toBeInTheDocument();

    expect(
      within(dialog).getByText(
        /Operations cannot create external custody locations/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("link", {
        name: "Open location management",
      }),
    ).not.toBeInTheDocument();

    const escalationLink = within(dialog).getByRole("link", {
      name: "Open Events to escalate setup",
    });
    expect(escalationLink).toHaveAttribute("href", "/events");
    expect(
      modulesForRole("operations").some(
        (module) => module.path === escalationLink.getAttribute("href"),
      ),
    ).toBe(true);

    const submit = within(dialog).getByRole("button", {
      name: "Create demand",
    });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(
      "Create demand is disabled because no external custody location exists.",
    );

    await userEvent.setup().click(submit);
    expect(create).not.toHaveBeenCalled();
  });

  it("gives a location administrator the direct reachable management route", async () => {
    renderSheet([warehouse], "warehouse_admin");
    const dialog = await selectThirdPartySource();

    const recoveryLink = within(dialog).getByRole("link", {
      name: "Open location management",
    });
    expect(recoveryLink).toHaveAttribute("href", "/locations");
    expect(
      modulesForRole("warehouse_admin").some(
        (module) => module.path === recoveryLink.getAttribute("href"),
      ),
    ).toBe(true);
    expect(
      within(dialog).queryByRole("link", {
        name: "Open Events to escalate setup",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps location and gross sales entry usable and requires gross sales before submission", async () => {
    const create = renderSheet([warehouse, externalLocation]);
    const dialog = await selectThirdPartySource();
    const user = userEvent.setup();

    const location = within(dialog).getByLabelText(
      "Third-party inventory location",
    );
    const grossSales = within(dialog).getByLabelText("Gross sales (PHP)");
    expect(location).toBeRequired();
    expect(grossSales).toBeRequired();

    await user.type(within(dialog).getByLabelText("Order reference"), "SALE-2408");
    await user.selectOptions(within(dialog).getByLabelText("Event"), "evt-makati");
    await user.selectOptions(location, "loc-event-makati");
    await user.click(
      within(dialog).getByRole("button", { name: "Create demand" }),
    );
    expect(create).not.toHaveBeenCalled();

    await user.type(grossSales, "8640");
    await user.click(
      within(dialog).getByRole("button", { name: "Create demand" }),
    );

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "third_party",
          thirdPartyLocationId: "loc-event-makati",
          grossSalesAmount: 8640,
        }),
      );
    });
  });
});
