import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  function mountDraft(create = vi.fn().mockResolvedValue(false), role: Role = "operations") {
    const view = renderWithProviders(<OrderIntakeSheet open onOpenChange={vi.fn()} products={[product]} locations={[warehouse, externalLocation]} events={events} create={create} />, { role });
    return { ...view, create };
  }

  it("resumes a long order only for its owner and discards it durably", async () => {
    const user = userEvent.setup();
    const first = mountDraft();
    await user.type(await screen.findByLabelText("Order reference"), "DRAFT-OWNER-A");
    expect(screen.getByText(/drafts are stored only in this browser/i)).toHaveTextContent(/customer addresses/i);
    await user.type(screen.getByLabelText("Order instructions"), "Keep both sets together");
    await user.type(screen.getByLabelText("Shipping fee"), "120");
    first.unmount();
    const other = mountDraft(undefined, "warehouse_operator");
    expect(await screen.findByLabelText("Order reference")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
    other.unmount();
    const owner = mountDraft();
    await user.click(await screen.findByRole("button", { name: "Resume draft" }));
    expect(screen.getByLabelText("Order reference")).toHaveValue("DRAFT-OWNER-A");
    expect(screen.getByLabelText("Order instructions")).toHaveValue("Keep both sets together");
    expect(screen.getByLabelText("Shipping fee")).toHaveValue(120);
    expect(owner.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.getByLabelText("Order reference")).toHaveValue("");
    owner.unmount();
    mountDraft();
    expect(await screen.findByLabelText("Order reference")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
  });

  it.each(["false", "throw"])("preserves a failed %s draft, then clears it only after confirmed success", async (failure) => {
    const user = userEvent.setup();
    const create = vi.fn().mockImplementationOnce(async () => {
      if (failure === "throw") throw new Error("Connection lost");
      return false;
    }).mockResolvedValue(true);
    const first = mountDraft(create);
    await user.selectOptions(await screen.findByLabelText("Demand source"), "event");
    await user.type(screen.getByLabelText("Order reference"), "PRESERVE-ME");
    await user.selectOptions(screen.getByLabelText("Event"), "evt-makati");
    await user.click(screen.getByRole("button", { name: "Create demand" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create demand" })).toBeEnabled());
    first.unmount();
    const retry = mountDraft(create);
    await user.click(await screen.findByRole("button", { name: "Resume draft" }));
    expect(screen.getByLabelText("Order reference")).toHaveValue("PRESERVE-ME");
    await user.click(screen.getByRole("button", { name: "Create demand" }));
    await screen.findByText("Demand added to the fulfillment queue.");
    retry.unmount();
    mountDraft(create);
    expect(await screen.findByLabelText("Order reference")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("freezes order edits and blocks duplicate submission while saving", async () => {
    let finish!: (ok: boolean) => void;
    const create = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    mountDraft(create);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Order reference"), "ONE-INTENT");
    const form = screen.getByLabelText("Order reference").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Order reference")).toBeDisabled();
    const savingLeave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, savingLeave);
    expect(savingLeave.defaultPrevented).toBe(true);
    await act(async () => finish(false));
    const savedLeave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, savedLeave);
    expect(savedLeave.defaultPrevented).toBe(false);
  });
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
