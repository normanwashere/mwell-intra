import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { WarehouseData } from "@/data/repository";
import { AllocationReturnSheet } from "./AllocationReturnSheet";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { allPending, _resetMemoryQueue } from "@/data/outbox";

async function setup(
  serialized = false,
  modify?: (data: WarehouseData) => void,
  source: "memory" | "supabase" = "memory",
) {
  const data = await makeRepo().getData();
  modify?.(data);
  const repo = makeRepo(data);
  const allocation = data.allocations.find(
    (row) => row.id === (serialized ? "alloc-2" : "alloc-1"),
  )!;
  const originalRecordReturn = repo.recordReturn.bind(repo);
  const recordReturn = vi.spyOn(repo, "recordReturn");
  const onOpenChange = vi.fn();
  renderWithProviders(
    <AllocationReturnSheet
      allocation={allocation}
      productName="Event stock"
      open
      onOpenChange={onOpenChange}
    />,
    {
      repo,
      role: "warehouse_operator",
      source,
      capabilities: ["manage_returns"],
    },
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(
      within(dialog).queryByText(/no issued units/i),
    ).not.toBeInTheDocument(),
  );
  return {
    repo,
    data,
    allocation,
    recordReturn,
    originalRecordReturn,
    onOpenChange,
    dialog,
    user: userEvent.setup(),
  };
}

describe("AllocationReturnSheet quarantine intake", () => {
  afterEach(() => _resetMemoryQueue());

  it('WE02 opens a partial bulk return at the remaining allocation quantity', async () => {
    const { dialog } = await setup(false, data => {
      const allocation = data.allocations.find(row => row.id === 'alloc-1')!;
      allocation.quantity = 10;
      data.returns.push({ id: 'partial-return-fixture', source: 'event', eventId: allocation.eventId,
        lines: [{ allocationId: allocation.id, productId: allocation.productId, quantity: 3, reason: 'unused' }],
        actor: 'fixture', createdAt: '2026-09-05T00:00:00Z' });
    });
    expect(within(dialog).getByText('7 remaining of 10 issued')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Quantity returned')).toHaveValue(7);
  });

  it("locks an uncertain return without claiming failure or allowing a duplicate retry", async () => {
    const { dialog, user, recordReturn, onOpenChange } = await setup();
    recordReturn.mockRejectedValueOnce(new Error("Response lost"));
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    const save = within(dialog).getByRole("button", { name: /^log return$/i });
    await user.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /unconfirmed/i,
    );
    expect(save).toBeDisabled();
    await user.click(save);
    expect(recordReturn).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Return logged in quarantine"),
    ).not.toBeInTheDocument();
  });

  it("does not label an offline queue entry as a confirmed quarantine return", async () => {
    const { dialog, user, recordReturn, onOpenChange } = await setup(
      false,
      undefined,
      "supabase",
    );
    recordReturn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    const save = within(dialog).getByRole("button", { name: /^log return$/i });
    await user.click(save);
    await waitFor(() => expect(recordReturn).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /pending sync|unconfirmed/i,
    );
    expect(save).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Return logged in quarantine"),
    ).not.toBeInTheDocument();
    expect(await allPending()).toHaveLength(1);
  });

  it("prevents double submission and closing while a return is saving", async () => {
    const { dialog, user, recordReturn, originalRecordReturn, onOpenChange } =
      await setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    recordReturn.mockImplementation(async (input) => {
      await pending;
      return originalRecordReturn(input);
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.dblClick(
      within(dialog).getByRole("button", { name: /^log return$/i }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(recordReturn).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(recordReturn).toHaveBeenCalledTimes(1);
  });

  it("excludes inactive locations and bins and blocks locations without an active bin", async () => {
    const { dialog, user } = await setup(false, (data) => {
      data.locations.find((location) => location.id === "loc-cebu")!.active =
        false;
      data.storageAreas.forEach((bin) => {
        if (bin.locationId === "loc-wh") bin.active = false;
      });
    });
    const location = within(dialog).getByLabelText("Quarantine location");
    expect(
      within(location).queryByRole("option", { name: "Cebu Hub" }),
    ).not.toBeInTheDocument();
    expect(
      within(location).queryByRole("option", { name: "Vendor Returns" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(location, "loc-wh");
    expect(within(dialog).getByText(/no active bins/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^log return$/i }),
    ).toBeDisabled();
  });

  it("rejects wrong-event and already-returned serials of the correct product", async () => {
    const { dialog, user } = await setup(true, (data) => {
      const unit = data.units.find((item) => item.productId === "ecg-ring-10")!;
      data.units.push({
        ...unit,
        id: "wrong-event",
        serialNumber: "WRONG-EVENT",
        status: "issued",
        eventId: "evt-bgc",
      });
      data.units.push({
        ...unit,
        id: "already-returned",
        serialNumber: "ALREADY-RETURNED",
        status: "pending_inspection",
        eventId: "evt-makati",
      });
    });
    const scan = within(dialog).getByLabelText("Enter barcode manually");
    await user.type(scan, "WRONG-EVENT");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /different event/i,
    );
    await user.type(scan, "ALREADY-RETURNED");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /cannot be returned/i,
    );
    expect(within(dialog).getByText("0 selected; 2 remaining of 2 issued")).toBeInTheDocument();
  });

  it("resets custody, reason, and evidence when reopening the same allocation", async () => {
    const repo = makeRepo();
    const allocation = (await repo.getData()).allocations.find(
      (row) => row.id === "alloc-1",
    )!;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open return</button>
          <AllocationReturnSheet
            allocation={allocation}
            productName="Event stock"
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { repo, role: "warehouse_operator" });
    let dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Unused",
    );
    await user.upload(
      within(dialog).getByLabelText("Attach return evidence"),
      new File(["photo"], "return.png", { type: "image/png" }),
    );
    await within(dialog).findByLabelText("Captured evidence");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Open return" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Quarantine location")).toHaveValue(
      "",
    );
    expect(within(dialog).getByLabelText("Reason (optional)")).toHaveValue("");
    expect(
      within(dialog).queryByLabelText("Captured evidence"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^log return$/i }),
    ).toBeDisabled();
  });

  it("requires a quarantine location and exact bin without final disposition choices", async () => {
    const { dialog, user, recordReturn } = await setup();
    const save = within(dialog).getByRole("button", { name: /^log return$/i });
    expect(
      within(dialog).queryAllByRole("option", {
        name: /restock|lost|return to vendor/i,
      }),
    ).toHaveLength(0);
    expect(save).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    expect(save).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    expect(save).toBeEnabled();
    expect(recordReturn).not.toHaveBeenCalled();
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-cebu",
    );
    expect(within(dialog).getByLabelText("Quarantine bin")).toHaveValue("");
    expect(save).toBeDisabled();
  });

  it("records an event return with quarantine custody and attached evidence", async () => {
    const { dialog, user, recordReturn, onOpenChange, repo } = await setup();
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-b1",
    );
    await user.upload(
      within(dialog).getByLabelText("Attach return evidence"),
      new File(["photo"], "return.png", { type: "image/png" }),
    );
    await within(dialog).findByLabelText("Captured evidence");
    await user.click(
      within(dialog).getByRole("button", { name: /^log return$/i }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(recordReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "event",
        eventId: "evt-makati",
        allocationId: "alloc-1",
        evidenceUrls: [expect.stringMatching(/^data:image\/png/)],
        lines: [
          expect.objectContaining({
            productId: "shirt-l",
            quantity: 100,
            disposition: "quarantine",
            locationId: "loc-wh",
            binId: "bin-pasig-b1",
          }),
        ],
      }),
    );
    const data = await repo.getData();
    const stock = data.stockLevels.find(
      (row) => row.productId === "shirt-l" && row.binId === "bin-pasig-b1",
    );
    expect(stock?.unavailable).toBe(100);
  });

  it("validates serial scans by event and product and records one quarantine line per selected serial", async () => {
    const { dialog, user, recordReturn, data, allocation, repo } =
      await setup(true);
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    const save = within(dialog).getByRole("button", { name: /^log return$/i });
    expect(save).toBeDisabled();
    const scan = within(dialog).getByLabelText("Enter barcode manually");
    await user.type(scan, "SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /does not match/i,
    );
    const issued = data.units.filter(
      (unit) =>
        unit.productId === allocation.productId &&
        unit.eventId === allocation.eventId &&
        unit.status === "issued",
    );
    expect(issued.length).toBeGreaterThan(0);
    await user.type(scan, issued[0]!.serialNumber);
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.click(save);
    await waitFor(() => expect(recordReturn).toHaveBeenCalledTimes(1));
    expect(recordReturn.mock.calls[0]![0].lines).toEqual([
      expect.objectContaining({
        quantity: 1,
        serialNumber: issued[0]!.serialNumber,
        disposition: "quarantine",
      }),
    ]);
    await waitFor(async () => {
      expect(
        (await repo.getData()).units.find((unit) => unit.id === issued[0]!.id)
          ?.status,
      ).toBe("pending_inspection");
    });
    expect(screen.queryByText(/allocation closed/i)).not.toBeInTheDocument();
  });
});
