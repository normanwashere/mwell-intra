import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReturnsPage } from "./ReturnsPage";
import { QualityPage } from "./QualityPage";
import { prepareReturnLines } from "./returnIntake";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { allPending, availableForProduct, removeEntry, ReturnRejectedError, SupabaseRepository } from "@intra/data-kit";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as evidenceStorage from "@/data/supabase/evidence";
import * as dataSource from "@/data/createRepository";

afterEach(() => vi.restoreAllMocks());

describe("ReturnsPage", () => {
  it("keeps an earlier unknown return frozen after a typed recovery rejection", async () => {
    const repo = makeRepo();
    const original = repo.recordReturn.bind(repo);
    const record = vi.spyOn(repo, "recordReturn")
      .mockImplementationOnce(async (input) => { await original(input); throw new Error("Response lost"); })
      .mockRejectedValueOnce(new ReturnRejectedError("Access revoked", "42501"));
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    await user.selectOptions(screen.getByLabelText("Quarantine bin"), "bin-pasig-a1");
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await user.click(await screen.findByRole("button", { name: "Recover original result" }));
    await screen.findByText(/earlier return outcome is still unknown/i);
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Recover original result" }));
    await screen.findByText("Return logged in inspection staging");
    expect(record.mock.calls[2]![0]).toEqual(record.mock.calls[0]![0]);
  });

  it("unlocks corrections only after an explicit first-attempt server rejection", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({ ...seed, returns: [], movements: [] });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "Quarantine bin is inactive" } });
    const live = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const record = vi.spyOn(repo, "recordReturn").mockImplementationOnce((input) => live.recordReturn(input));
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    await user.selectOptions(screen.getByLabelText("Quarantine bin"), "bin-pasig-a1");
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Quarantine bin is inactive");
    expect(screen.getByLabelText("Quantity")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Recover original result" })).not.toBeInTheDocument();
    expect((await repo.getData()).returns).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Return logged in inspection staging");
    expect(record.mock.calls[1]![0].idempotencyKey).not.toBe(record.mock.calls[0]![0].idempotencyKey);
    expect((await repo.getData()).returns).toHaveLength(1);
    expect((await repo.getData()).returns[0]!.lines[0]!.quantity).toBe(2);
  });

  it("blocks submission during evidence upload and cancels evidence from an old return context", async () => {
    const repo = makeRepo();
    const record = vi.spyOn(repo, "recordReturn");
    vi.spyOn(dataSource, "resolveDataSource").mockReturnValue("supabase");
    let finish!: (path: string) => void;
    const upload = vi.spyOn(evidenceStorage, "uploadEvidence").mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    await user.selectOptions(screen.getByLabelText("Quarantine bin"), "bin-pasig-a1");
    await user.upload(screen.getByLabelText("Attach return evidence"), new File(["photo"], "return.png", { type: "image/png" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Record return" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Record return" }));
    expect(record).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Return source"), "vendor");
    await act(async () => finish("evidence/old-customer-return.png"));
    expect(screen.queryByRole("list", { name: "Captured evidence" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Return logged in inspection staging");
    expect(record.mock.calls[0]![0]).toMatchObject({ source: "vendor", evidenceUrls: [] });
  });

  it("does not send a return if its immutable intent cannot be saved", async () => {
    const repo = makeRepo();
    const record = vi.spyOn(repo, "recordReturn");
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    await user.selectOptions(screen.getByLabelText("Quarantine bin"), "bin-pasig-a1");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    await user.click(screen.getByRole("button", { name: "Record return" }));
    expect(record).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/draft could not be saved/i);
    expect(screen.getByLabelText("Product")).toHaveValue("shirt-l");
  });

  it("recovers an immutable serialized return after reload and a lost committed response", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({ ...seed, returns: [], movements: [] });
    const original = repo.recordReturn.bind(repo);
    const record = vi.spyOn(repo, "recordReturn").mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error("Network response lost");
    });
    const user = userEvent.setup();
    const view = renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.type(screen.getByLabelText("Serial number"), "SMART-WATCH-VIP001");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    await user.selectOptions(screen.getByLabelText("Quarantine bin"), "bin-pasig-a1");
    await user.upload(screen.getByLabelText("Attach return evidence"), new File(["photo"], "return.png", { type: "image/png" }));
    await screen.findByRole("list", { name: "Captured evidence" });
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Network response lost");
    for (const label of ["Product", "Quantity", "Reason", "Serial number", "Attach return evidence"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.type(screen.getByLabelText("Serial number"), "CHANGED");
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(screen.getByLabelText("Serial number")).toHaveValue("SMART-WATCH-VIP001");
    view.unmount();
    const other = renderWithProviders(<ReturnsPage />, { role: "operations", repo });
    await screen.findByText("Recent returns");
    expect(screen.queryByRole("button", { name: "Recover original result" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product")).toHaveValue("");
    other.unmount();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByRole("button", { name: "Recover original result" });
    expect(record).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Serial number")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Recover original result" }));
    await screen.findByText("Return logged in inspection staging");
    expect(record.mock.calls[1]![0]).toEqual(record.mock.calls[0]![0]);
    expect((await repo.getData()).returns).toHaveLength(1);
    expect((await repo.getData()).movements).toHaveLength(1);
  });

  it("offers resume and discard for an unfinished return without submitting on reload", async () => {
    const repo = makeRepo();
    const record = vi.spyOn(repo, "recordReturn");
    const user = userEvent.setup();
    const view = renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.click(screen.getByRole("button", { name: "Increase" }));
    view.unmount();
    const resumed = renderWithProviders(<ReturnsPage />, { repo });
    await user.click(await screen.findByRole("button", { name: "Resume draft" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue(2);
    expect(record).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.getByLabelText("Product")).toHaveValue("");
    resumed.unmount();
    renderWithProviders(<ReturnsPage />, { repo });
    await screen.findByText("Recent returns");
    expect(screen.queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
  });
  it("excludes inactive quarantine locations and bins", async () => {
    const seed = await makeRepo().getData();
    const location = seed.locations.find((row) => row.id === "loc-wh")!;
    const bin = seed.storageAreas.find((row) => row.id === "bin-pasig-a1")!;
    seed.locations.push({ ...location, id: "inactive-return-location", name: "Inactive return location", active: false });
    bin.active = false;
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo: makeRepo(seed) });
    await screen.findByText(/recent returns/i);
    expect(screen.queryByRole("option", { name: "Inactive return location" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(screen.getByLabelText("Quarantine location"), "loc-wh");
    const binSelect = screen.queryByLabelText("Quarantine bin");
    if (binSelect) expect(within(binSelect).queryByRole("option", { name: new RegExp(bin.code) })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record return" })).toBeDisabled();
  });
  it("keeps the uninspected serial in Quality after accepting one device from a multi-serial intake", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({
      ...seed,
      returns: [],
      receipts: [],
      movements: [],
    });
    const prepared = prepareReturnLines(
      seed,
      [
        {
          id: 0,
          productId: "ecg-ring-10",
          quantity: 2,
          reason: "defective",
          serials: "ECG-RING-10-SN0001\nECG-RING-10-SN0002",
        },
      ],
      "evt-makati",
    );
    const returned = await repo.recordReturn({
      source: "event",
      eventId: "evt-makati",
      actor: "return-receiver",
      lines: prepared.lines.map((line) => ({
        ...line,
        locationId: "loc-wh",
        binId: "bin-pasig-a1",
      })),
    });
    await repo.inspectQuality({
      idempotencyKey: "return-first-serial-inspection",
      sourceType: "return",
      sourceId: returned.id,
      productId: "ecg-ring-10",
      serialNumber: "ECG-RING-10-SN0001",
      binId: "bin-pasig-a1",
      quantity: 1,
      disposition: "accepted",
    });
    expect(
      (await repo.getData()).units.find(
        (unit) => unit.serialNumber === "ECG-RING-10-SN0002",
      )?.status,
    ).toBe("pending_inspection");
    renderWithProviders(<QualityPage />, { repo, role: "warehouse_operator" });
    const pending = await screen.findByRole("list", {
      name: "Pending inspections",
    });
    expect(within(pending).getAllByRole("button", { name: "Inspect" })).toHaveLength(1);
    expect(within(pending).getByText(/ECG-RING-10-SN0002/)).toBeInTheDocument();
  });

  it("allows a removed serial to be scanned again without retaining stale duplicates", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.type(
      screen.getByLabelText("Enter barcode manually"),
      "SMART-WATCH-VIP001",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.clear(screen.getByLabelText("Serial number"));
    await user.type(
      screen.getByLabelText("Enter barcode manually"),
      "SMART-WATCH-VIP001",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Serial number")).toHaveValue(
      "SMART-WATCH-VIP001",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps one complete intake in flight and freezes its editable fields", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({ ...seed, returns: [], movements: [] });
    const original = repo.recordReturn.bind(repo);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const record = vi
      .spyOn(repo, "recordReturn")
      .mockImplementation(async (input) => {
        await pending;
        return original(input);
      });
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.dblClick(screen.getByRole("button", { name: "Record return" }));
    try {
      expect(record).toHaveBeenCalledTimes(1);
      for (const label of [
        "Product",
        "Quantity",
        "Reason",
        "Return source",
        "Quarantine location",
        "Quarantine bin",
        "Attach return evidence",
      ]) {
        expect(screen.getByLabelText(label)).toBeDisabled();
      }
      expect(
        screen.getByRole("button", { name: "Add product" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Recording return..." }),
      ).toBeDisabled();
    } finally {
      await act(async () => {
        release();
        await pending;
      });
    }
    await screen.findByText("Return logged in inspection staging");
    expect((await repo.getData()).returns).toHaveLength(1);
  });

  it("reuses the intake key after failure and rotates it only after confirmed success", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({ ...seed, returns: [], movements: [] });
    const record = vi
      .spyOn(repo, "recordReturn")
      .mockRejectedValueOnce(new Error("Return rejected"));
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Return rejected");
    expect(screen.getByLabelText("Product")).toHaveValue("shirt-l");
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Recover original result" }));
    await waitFor(async () =>
      expect((await repo.getData()).returns).toHaveLength(1),
    );
    const firstInput = record.mock.calls[0]![0] as { idempotencyKey?: string };
    const retryInput = record.mock.calls[1]![0] as { idempotencyKey?: string };
    expect(firstInput.idempotencyKey).toMatch(/^return-intake-/);
    expect(retryInput.idempotencyKey).toBe(firstInput.idempotencyKey);
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await waitFor(async () =>
      expect((await repo.getData()).returns).toHaveLength(2),
    );
    const nextInput = record.mock.calls[2]![0] as { idempotencyKey?: string };
    expect(nextInput.idempotencyKey).not.toBe(firstInput.idempotencyKey);
  });

  it("does not duplicate successful product lines when retrying after a lost response", async () => {
    const seed = await makeRepo().getData();
    const repo = makeRepo({ ...seed, returns: [], movements: [] });
    const original = repo.recordReturn.bind(repo);
    const record = vi
      .spyOn(repo, "recordReturn")
      .mockImplementationOnce(async (input) => {
        await original(input);
        throw new Error("Network response lost");
      });
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.click(screen.getByRole("button", { name: "Add product" }));
    const second = within(
      screen.getByRole("group", { name: "Return product 2" }),
    );
    await user.selectOptions(second.getByLabelText("Product"), "shirt-m");
    await user.click(second.getByRole("button", { name: "Increase" }));
    await user.click(screen.getByRole("button", { name: "Record return" }));
    await screen.findByText("Network response lost");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Recover original result" }),
      ).toBeEnabled(),
    );
    expect((await repo.getData()).returns).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Recover original result" }));
    await screen.findByText("Return logged in inspection staging");
    expect(record.mock.calls[1]![0]).toEqual(record.mock.calls[0]![0]);
    const after = await repo.getData();
    expect(after.returns).toHaveLength(1);
    expect(after.movements).toHaveLength(2);
    expect(after.returns[0]!.lines).toEqual([
      expect.objectContaining({ productId: "shirt-l", quantity: 1 }),
      expect.objectContaining({ productId: "shirt-m", quantity: 2 }),
    ]);
  });

  it.each(["rejected", "response lost"] as const)(
    "does not complete or clear a multi-product intake when %s",
    async (failure) => {
      const seed = await makeRepo().getData();
      const repo = makeRepo({ ...seed, returns: [], movements: [] });
      const originalRecordReturn = repo.recordReturn.bind(repo);
      const record = vi.spyOn(repo, "recordReturn").mockImplementationOnce(async (input) => {
        if (failure === "response lost") await originalRecordReturn(input);
        throw new Error(
          failure === "response lost"
            ? "Network response lost"
            : "Return rejected",
        );
      });
      const user = userEvent.setup();
      const view = renderWithProviders(<ReturnsPage />, {
        role: "warehouse_operator",
        repo,
        source: "supabase",
        capabilities: ["manage_returns"],
      });
      try {
        await screen.findByText(/recent returns/i);
        await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
        await user.selectOptions(
          screen.getByLabelText("Quarantine location"),
          "loc-wh",
        );
        await user.selectOptions(
          screen.getByLabelText("Quarantine bin"),
          "bin-pasig-a1",
        );
        await user.click(screen.getByRole("button", { name: "Add product" }));
        const second = within(
          screen.getByRole("group", { name: "Return product 2" }),
        );
        await user.selectOptions(second.getByLabelText("Product"), "shirt-l");
        await user.click(second.getByRole("button", { name: "Increase" }));
        await user.click(screen.getByRole("button", { name: "Record return" }));
        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "Recording return..." }),
          ).not.toBeInTheDocument(),
        );
        expect(
          screen.queryByText("Return logged in inspection staging"),
        ).not.toBeInTheDocument();
        expect(screen.getAllByLabelText("Product")).toHaveLength(2);
        expect(second.getByLabelText("Quantity")).toHaveValue(2);
        expect((await repo.getData()).returns).toHaveLength(
          failure === "response lost" ? 1 : 0,
        );
        expect(await allPending()).toHaveLength(0);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0]![0].lines).toHaveLength(2);
      } finally {
        view.unmount();
        for (const entry of await allPending()) await removeEntry(entry.id);
      }
    },
  );

  it("records multiple products and serials in one quarantine intake with event evidence", async () => {
    const seed = await makeRepo().getData();
    const watch = seed.units.find(
      (unit) => unit.serialNumber === "SMART-WATCH-VIP001",
    )!;
    const repo = makeRepo({
      ...seed,
      returns: [],
      movements: [],
      units: [
        ...seed.units,
        { ...watch, id: "watch-vip-2", serialNumber: "SMART-WATCH-VIP002" },
      ],
    });
    const before = await repo.getData();
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText(/recent returns/i);

    await user.selectOptions(screen.getByLabelText("Return source"), "event");
    await user.selectOptions(
      screen.getByLabelText("Return from event"),
      "evt-vip",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.selectOptions(screen.getByLabelText("Reason"), "wrong size");
    await user.click(screen.getByRole("button", { name: "Add product" }));
    const second = within(
      screen.getByRole("group", { name: "Return product 2" }),
    );
    await user.selectOptions(second.getByLabelText("Product"), "smart-watch");
    await user.click(second.getByRole("button", { name: "Increase" }));
    await user.type(
      second.getByLabelText("Serial numbers"),
      "smart-watch-vip001\nSMART-WATCH-VIP002",
    );
    await user.upload(
      screen.getByLabelText("Attach return evidence"),
      new File(["return photo"], "return.png", { type: "image/png" }),
    );
    await screen.findByRole("list", { name: "Captured evidence" });
    await user.click(screen.getByRole("button", { name: "Record return" }));

    await waitFor(async () =>
      expect((await repo.getData()).returns).toHaveLength(1),
    );
    const after = await repo.getData();
    const returned = after.returns[0]!;
    expect(returned).toMatchObject({
      source: "event",
      eventId: "evt-vip",
      evidenceUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
      lines: [
        {
          productId: "shirt-l",
          quantity: 3,
          reason: "wrong size",
          locationId: "loc-wh",
          binId: "bin-pasig-a1",
          disposition: "quarantine",
        },
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumber: "SMART-WATCH-VIP001",
          reason: "defective",
          locationId: "loc-wh",
          binId: "bin-pasig-a1",
          disposition: "quarantine",
        },
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumber: "SMART-WATCH-VIP002",
          reason: "defective",
          locationId: "loc-wh",
          binId: "bin-pasig-a1",
          disposition: "quarantine",
        },
      ],
    });
    expect(after.movements).toHaveLength(3);
    for (const movement of after.movements) {
      expect(movement).toMatchObject({
        type: "return",
        reference: returned.id,
        eventId: "evt-vip",
        evidenceUrls: returned.evidenceUrls,
        toLocationId: "loc-wh",
        toBinId: "bin-pasig-a1",
      });
    }
    for (const serialNumber of ["SMART-WATCH-VIP001", "SMART-WATCH-VIP002"]) {
      expect(
        after.units.find((unit) => unit.serialNumber === serialNumber),
      ).toMatchObject({
        status: "pending_inspection",
        locationId: "loc-wh",
        binId: "bin-pasig-a1",
      });
    }
    for (const productId of ["shirt-l", "smart-watch"]) {
      expect(availableForProduct(after, productId)).toBe(
        availableForProduct(before, productId),
      );
      expect(
        availableForProduct(after, productId, "loc-wh", "bin-pasig-a1"),
      ).toBe(availableForProduct(before, productId, "loc-wh", "bin-pasig-a1"));
    }
    expect(
      within(screen.getByLabelText("Returns")).getByText(
        "VIP Doctor Appreciation",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Returns")).getByText("SMART-WATCH-VIP002"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Disposition")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Captured evidence" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Product")).toHaveLength(1);
    expect(screen.getByLabelText("Product")).toHaveValue("");
  });

  it("blocks incomplete added lines and preserves other products when a line is removed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(
      screen.getByRole("button", { name: "Record return" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove product 2" }));
    expect(screen.getByLabelText("Product")).toHaveValue("shirt-l");
    expect(screen.getByLabelText("Quantity")).toHaveValue(2);
    expect(screen.getByRole("button", { name: "Record return" })).toBeEnabled();
  });

  it("validates serial counts and rejects duplicate serials across product lines", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    await user.click(screen.getByRole("button", { name: "Increase" }));
    await user.type(
      screen.getByLabelText("Serial numbers"),
      "SMART-WATCH-VIP001",
    );
    expect(
      screen.getByRole("button", { name: "Record return" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/2 serial numbers/i);
    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(screen.getByRole("button", { name: "Record return" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add product" }));
    const second = within(
      screen.getByRole("group", { name: "Return product 2" }),
    );
    await user.selectOptions(second.getByLabelText("Product"), "smart-watch");
    await user.type(
      second.getByLabelText("Serial number"),
      "smart-watch-vip001",
    );
    expect(
      screen.getByRole("button", { name: "Record return" }),
    ).toBeDisabled();
    expect(second.getByRole("alert")).toHaveTextContent(/already.*return/i);
    await user.selectOptions(second.getByLabelText("Product"), "shirt-l");
    expect(second.queryByLabelText("Serial number")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record return" })).toBeEnabled();
    await user.selectOptions(
      screen.getByLabelText("Related event (optional)"),
      "evt-makati",
    );
    expect(
      screen.getByRole("button", { name: "Record return" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/different event/i);
  });

  it("records physical returns into quarantine without exposing a final disposition", async () => {
    renderWithProviders(<ReturnsPage />);

    expect(
      await screen.findByText(/quality control chooses the final disposition/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Disposition")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quarantine location")).toBeInTheDocument();
  });

  it("keeps the quality handoff only when the live returns bundle can open it", async () => {
    renderWithProviders(<ReturnsPage />, {
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["manage_returns"],
    });
    await screen.findByText(/recent returns/i);
    expect(
      screen.getByRole("link", { name: /open quality queue/i }),
    ).toHaveAttribute("href", "/quality");
  });

  // The seeded returns list is larger since the 90-day history landed; give
  // the record-and-rerender flow more headroom than the 5s default.
  it(
    "records a customer return and shows it in the list",
    { timeout: 15_000 },
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
      await screen.findByText(/recent returns/i);

      await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
      await user.selectOptions(
        screen.getByLabelText("Quarantine location"),
        "loc-wh",
      );
      await user.selectOptions(
        screen.getByLabelText("Quarantine bin"),
        "bin-pasig-a1",
      );
      const qty = screen.getByLabelText("Quantity");
      await user.clear(qty);
      await user.type(qty, "3");
      await user.selectOptions(screen.getByLabelText("Reason"), "wrong size");
      await user.click(screen.getByRole("button", { name: /record return/i }));

      await waitFor(() => {
        const list = screen.getByLabelText("Returns");
        expect(
          within(list).getByText(/Event Shirt \(L\)/i),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText(/return logged in inspection staging/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /open quality queue/i }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByLabelText("Returns")).getAllByText("Quarantined")
          .length,
      ).toBeGreaterThan(0);
    },
  );

  it("reveals a serial field and requires it for serialized devices", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);

    expect(screen.queryByLabelText("Serial number")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Product"), "ecg-ring-10");
    expect(screen.getByLabelText("Serial number")).toBeInTheDocument();
    // submit is blocked until a serial is supplied
    expect(
      screen.getByRole("button", { name: /record return/i }),
    ).toBeDisabled();

    await user.type(
      screen.getByLabelText("Serial number"),
      "ECG-RING-10-SN0001",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    expect(
      screen.getByRole("button", { name: /record return/i }),
    ).toBeEnabled();
  });

  it("accepts only an issued serial for the selected return product and event", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.selectOptions(
      screen.getByLabelText("Related event (optional)"),
      "evt-vip",
    );
    const manual = screen.getByLabelText("Enter barcode manually");
    await user.type(manual, "SMART-WATCH-SN0001");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be returned/i);
    await user.type(manual, "SMART-WATCH-VIP001");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("status")).toHaveTextContent(/scan accepted/i);
    expect(screen.getByLabelText("Serial number")).toHaveValue(
      "SMART-WATCH-VIP001",
    );
  });

  it("receives a return from a specific event into a selected bin", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator", repo });
    await screen.findByText(/recent returns/i);

    await user.selectOptions(screen.getByLabelText("Return source"), "event");
    await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
    await user.selectOptions(
      screen.getByLabelText("Quarantine location"),
      "loc-wh",
    );
    await user.selectOptions(
      screen.getByLabelText("Quarantine bin"),
      "bin-pasig-a1",
    );
    expect(
      screen.getByRole("button", { name: "Record return" }),
    ).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText("Return from event"),
      "evt-makati",
    );
    await user.click(screen.getByRole("button", { name: "Record return" }));

    await waitFor(async () => {
      expect((await repo.getData()).returns.at(-1)).toMatchObject({
        source: "event",
        eventId: "evt-makati",
        lines: [
          expect.objectContaining({
            locationId: "loc-wh",
            binId: "bin-pasig-a1",
          }),
        ],
      });
    });
  });
});
