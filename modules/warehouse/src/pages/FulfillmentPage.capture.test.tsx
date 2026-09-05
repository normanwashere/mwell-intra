import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

async function setup(status: "picking" | "ready" = "picking", quantity = 2) {
  const seed = makeRepo();
  const order = await seed.createFulfillmentOrder({
    source: "ecommerce", externalReference: "CAPTURE-REGRESSION", sourceLocationId: "loc-wh",
    lines: [{ productId: "smart-watch", quantity }], actor: "requester",
  });
  const data = await seed.getData();
  data.fulfillmentOrders[0] = { ...order, status, deliveryMethod: "shipment", courier: "Courier", waybillNumber: "WB-1" };
  data.storageAreas = [
    { id: "bin-a", locationId: "loc-wh", code: "A-01", active: true },
    { id: "bin-b", locationId: "loc-wh", code: "B-01", active: true },
  ];
  data.units = [
    { id: "u1", productId: "smart-watch", serialNumber: "GOOD-1", locationId: "loc-wh", binId: "bin-a", status: "in_stock" },
    { id: "u2", productId: "smart-watch", serialNumber: "GOOD-2", locationId: "loc-wh", binId: "bin-a", status: "in_stock" },
    { id: "u3", productId: "smart-watch", serialNumber: "WRONG-BIN", locationId: "loc-wh", binId: "bin-b", status: "in_stock" },
    { id: "u4", productId: "smart-watch", serialNumber: "HELD", locationId: "loc-wh", binId: "bin-a", status: "pending_inspection" },
    { id: "u5", productId: "shirt-l", serialNumber: "WRONG-PRODUCT", locationId: "loc-wh", binId: "bin-a", status: "in_stock" },
    { id: "u6", productId: "smart-watch", serialNumber: "WRONG-LOCATION", locationId: "elsewhere", binId: "bin-a", status: "in_stock" },
  ];
  if (quantity > 2) data.units.push(...Array.from({ length: quantity - 2 }, (_, index) => ({
    id: `extra-${index}`, productId: "smart-watch", serialNumber: `GOOD-${index + 3}`,
    locationId: "loc-wh", binId: "bin-a", status: "in_stock" as const,
  })));
  const repo = makeRepo(data);
  const advance = vi.spyOn(repo, "advanceFulfillmentOrder");
  const user = userEvent.setup();
  renderWithProviders(<FulfillmentPage />, { repo, role: "warehouse_operator" });
  await user.click(await screen.findByRole("button", { name: status === "picking" ? "Confirm scanned pick" : "View order details" }));
  const dialog = await screen.findByRole("dialog");
  const bin = () => within(dialog).getByLabelText(/Scanned bin code for/);
  const serial = () => within(dialog).getByLabelText(/^Enter serial for/);
  const scanBin = async (value = "A-01") => { await user.type(bin(), `${value}{Enter}`); };
  const scanSerial = async (value: string) => { await user.type(serial(), `${value}{Enter}`); };
  return { user, dialog, advance, scanBin, scanSerial, serial, order };
}

describe("Fulfillment capture audit regressions", () => {
  it("retains 20 serials and replays the identical command after a committed response is lost", async () => {
    const { dialog, user, scanBin, advance, order } = await setup("picking", 20);
    await scanBin();
    const serials = Array.from({ length: 20 }, (_, index) => `GOOD-${index + 1}`).join("\n");
    const draft = within(dialog).getByLabelText(/Scanned serial numbers/);
    fireEvent.change(draft, { target: { value: serials } });
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "Keep capturing" }));
    expect(draft).toHaveValue(serials);
    const committed = new Map<string, unknown>();
    let effects = 0;
    const result = { ...order, status: "packing" as const };
    advance.mockImplementation(async input => {
      const key = `advance_${input.action}-${input.orderId}`;
      if (!committed.has(key)) {
        committed.set(key, structuredClone(input)); effects += 1;
        throw new Error("Response lost after commit");
      }
      expect(input).toEqual(committed.get(key));
      return result;
    });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(draft).toBeDisabled());
    expect(draft).toHaveValue(serials);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Confirm pick" })).toBeEnabled());
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledTimes(2);
    expect(advance.mock.calls[1]![0]).toEqual(advance.mock.calls[0]![0]);
    expect(effects).toBe(1);
  });
  it("matches the floor-work deep link exactly and keeps released follow-up separate", async () => {
    const seed = makeRepo();
    const base = await seed.createFulfillmentOrder({ source: "ecommerce", externalReference: "BASE", sourceLocationId: "loc-wh", lines: [{ productId: "smart-watch", quantity: 1 }], actor: "requester" });
    const data = await seed.getData();
    data.fulfillmentOrders = (["received", "allocated", "picking", "packing", "ready", "released", "completed", "cancelled"] as const).map((status) => ({ ...base, id: status, externalReference: `FLOOR-${status}`, status }));
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), role: "warehouse_operator", route: "/fulfillment?filter=floor_work" });
    expect(await screen.findByLabelText("Status")).toHaveValue("floor_work");
    const list = screen.getByRole("list", { name: "Fulfillment demand" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).queryByText("FLOOR-released")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Released follow-up: 1" }));
    expect(within(list).getByText("FLOOR-released")).toBeVisible();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
  it("requires the correct bin and rejects invalid serials without increasing capture", async () => {
    const { dialog, scanBin, scanSerial, serial, advance } = await setup();
    expect(serial()).toBeDisabled();
    await scanBin("B-01");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Wrong source bin");
    expect(serial()).toBeDisabled();
    await scanBin();
    expect(serial()).toBeEnabled();
    for (const code of ["UNKNOWN", "WRONG-BIN", "HELD", "WRONG-PRODUCT", "WRONG-LOCATION"]) {
      await scanSerial(code);
      expect(within(dialog).getByLabelText(/Scanned serial numbers/)).toHaveValue("");
      expect(within(dialog).getByRole("alert")).toBeVisible();
    }
    await scanSerial("good-1");
    await scanSerial("GOOD-1");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already scanned");
    expect(within(dialog).getByLabelText(/Scanned serial numbers/)).toHaveValue("GOOD-1");
    expect(advance).not.toHaveBeenCalled();
  });

  it("revalidates pasted serials and keeps the draft when a new bin scan is wrong", async () => {
    const { dialog, user, scanBin, advance } = await setup();
    await scanBin();
    const draft = within(dialog).getByLabelText(/Scanned serial numbers/);
    fireEvent.change(draft, { target: { value: "GOOD-1\nWRONG-BIN" } });
    await user.click(within(dialog).getByRole("button", { name: "Confirm pick" }));
    expect(advance).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("verified source bin");
    await scanBin("UNKNOWN");
    expect(draft).toHaveValue("GOOD-1\nWRONG-BIN");
    expect(draft).toBeDisabled();
  });

  it("requires explicit discard on Escape and close, retaining the capture otherwise", async () => {
    const { dialog, user, scanBin, scanSerial } = await setup();
    await scanBin();
    await scanSerial("GOOD-1");
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Keep capturing" }));
    expect(within(dialog).getByLabelText(/Scanned serial numbers/)).toHaveValue("GOOD-1");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Discard capture" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("locks double submission and dismissal while saving and preserves failed captures", async () => {
    const { dialog, user, scanBin, scanSerial, advance } = await setup();
    let reject!: (error: Error) => void;
    advance.mockImplementationOnce(() => new Promise((_resolve, rej) => { reject = rej; }));
    await scanBin();
    await scanSerial("GOOD-1");
    await scanSerial("GOOD-2");
    const form = dialog.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(advance).toHaveBeenCalledOnce());
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Discard capture" })).not.toBeInTheDocument();
    await act(async () => reject(new Error("Lost response")));
    expect(within(dialog).getByLabelText(/Scanned serial numbers/)).toHaveValue("GOOD-1\nGOOD-2");
    expect(within(dialog).getByRole("button", { name: "Confirm pick" })).toBeEnabled();
  });

  it("does not describe a ready shipment's absent tracking link as pending packing", async () => {
    const { dialog } = await setup("ready");
    expect(within(dialog).getByText("No tracking link provided")).toBeVisible();
    expect(within(dialog).queryByText("Pending packing")).not.toBeInTheDocument();
  });
});
