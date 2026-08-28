import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PROCUREMENT_PO_KEY } from "@/data/procurementBridge";
import { InMemoryRepository } from "@/data/inMemoryRepository";
import { buildSeed, type ReceiveProcurementPOInput } from "@intra/data-kit";
import type { ReceivingProgress } from "@/data/receivingProgress";
import * as evidenceStorage from "@/data/supabase/evidence";
import * as repositorySource from "@/data/createRepository";

const liveDrafts = vi.hoisted(() => ({ enabled: false, rpc: vi.fn() }));
const camera = vi.hoisted(() => ({
  detected: null as ((code: string) => void) | null,
}));

vi.mock("@intra/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@intra/auth")>();
  const client = { schema: () => ({ rpc: liveDrafts.rpc }) };
  return {
    ...actual,
    useSession: () => {
      const session = actual.useSession();
      return liveDrafts.enabled
        ? { ...session, mode: "supabase", supabaseClient: client }
        : session;
    },
  };
});

vi.mock("@/components/camera/scanEngine", () => ({
  createScanEngine: () => ({
    start: async (
      _video: HTMLVideoElement,
      detected: (code: string) => void,
    ) => {
      camera.detected = detected;
    },
    stop: () => undefined,
  }),
}));

const draftKey = "intra.receiving-draft.v1:demo-logistics_supervisor:live-po-1";
const savedAt = "2026-08-28T01:00:00.000Z";

function savedProgress(serials = "SAVED-1"): ReceivingProgress {
  return {
    version: 1,
    locationId: "loc-wh",
    binId: "",
    evidenceLink: "",
    evidencePhotos: [],
    reason: "",
    lines: [
      {
        id: "live-line-1",
        expected: 2,
        selected: true,
        productId: "smart-watch",
        description: "Smart watches",
        identifiers: "",
        outcomes: {
          clean: 2,
          damaged: 0,
          unidentified: 0,
          short: 0,
          excess: 0,
        },
        serials: { clean: serials, damaged: "", unidentified: "", excess: "" },
      },
    ],
  };
}

function draftRecord(version = 0, body: ReceivingProgress | null = null) {
  return {
    status: "ok",
    po_id: "live-po-1",
    body,
    version,
    updated_at: version ? savedAt : null,
  };
}

function renderReceiving(repo = new LiveProcurementRepository()) {
  return renderWithProviders(<PurchaseOrdersPage />, {
    role: "logistics_supervisor",
    repo,
    source: "supabase",
    capabilities: ["receive_stock"],
  });
}

async function openReceiving(
  user: ReturnType<typeof userEvent.setup>,
  index = 0,
) {
  await user.click(
    within(await screen.findByLabelText("Purchase orders")).getAllByRole(
      "button",
      { name: /^receive and inspect$/i },
    )[index]!,
  );
  const dialog = await screen.findByRole("dialog", {
    name: /receive approved procurement po/i,
  });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: /save progress/i }),
    ).toBeEnabled(),
  );
  return dialog;
}

function completeReceipt(dialog: HTMLElement) {
  fireEvent.change(
    within(dialog).getByLabelText(/clean serials for smart watches/i),
    { target: { value: "RECEIVE-1\nRECEIVE-2" } },
  );
  fireEvent.change(within(dialog).getByLabelText(/delivery evidence url/i), {
    target: { value: "evidence/delivery.jpg" },
  });
}

class LiveProcurementRepository extends InMemoryRepository {
  receivedInputs: ReceiveProcurementPOInput[] = [];

  constructor(
    private readonly quantity = 2,
    private readonly secondLine = false,
  ) {
    const data = structuredClone(buildSeed());
    data.purchaseOrders.push({
      id: "live-po-1",
      supplierId: data.suppliers[0]!.id,
      status: "ordered",
      lines: [
        {
          productId: "smart-watch",
          quantityOrdered: quantity,
          quantityReceived: 0,
        },
      ],
      createdAt: savedAt,
      actor: "receiving-test",
    });
    super(data, { storage: null });
  }

  override async getReceivableProcurementPOs() {
    return [
      {
        id: "live-po-1",
        poNumber: "PO-LIVE-001",
        vendorName: "Live Medical Vendor",
        status: "issued" as const,
        lines: [
          {
            id: "live-line-1",
            productId: "smart-watch",
            description: "Smart watches",
            quantity: this.quantity,
            receivedQuantity: 0,
          },
          ...(this.secondLine
            ? [
                {
                  id: "live-line-2",
                  productId: "smart-watch",
                  description: "Second SKU",
                  quantity: 2,
                  receivedQuantity: 0,
                },
              ]
            : []),
        ],
      },
    ];
  }

  override async receiveProcurementPO(input: ReceiveProcurementPOInput) {
    this.receivedInputs.push(input);
    if (input.mode !== "breakdown") return super.receiveProcurementPO(input);
    // The in-memory adapter binds lines by PO/index instead of live line IDs.
    return super.receiveProcurementPO({
      ...input,
      lines: input.lines.map((line, index) => ({
        ...line,
        lineId: `${input.poId}-${index}`,
      })),
    });
  }
}

describe("PurchaseOrdersPage", () => {
  beforeEach(() => {
    liveDrafts.enabled = false;
    liveDrafts.rpc.mockReset();
    camera.detected = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["another PO", "the same PO"])(
    "ignores a late evidence upload after closing and reopening %s",
    async (destination) => {
      const samePO = destination === "the same PO";
      const user = userEvent.setup();
      const repo = new LiveProcurementRepository();
      const rows = await repo.getReceivableProcurementPOs();
      vi.spyOn(repo, "getReceivableProcurementPOs").mockResolvedValue([
        ...rows,
        { ...rows[0]!, id: "live-po-2", poNumber: "PO-LIVE-002" },
      ]);
      vi.spyOn(repositorySource, "resolveDataSource").mockReturnValue(
        "supabase",
      );
      vi.spyOn(evidenceStorage, "resolveEvidenceUrl").mockResolvedValue(
        "https://example.com/photo.jpg",
      );
      let finishUpload!: (path: string) => void;
      const upload = vi
        .spyOn(evidenceStorage, "uploadEvidence")
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              finishUpload = resolve;
            }),
        );
      renderReceiving(repo);
      let dialog = await openReceiving(user);
      await user.upload(
        within(dialog).getByLabelText(/upload or photograph delivery note/i),
        new File(["photo"], "delivery.png", { type: "image/png" }),
      );
      await waitFor(() => expect(upload).toHaveBeenCalledOnce());
      await user.click(
        within(dialog).getByRole("button", { name: /^close$/i }),
      );
      dialog = await openReceiving(user, samePO ? 0 : 1);
      await act(async () => finishUpload("evidence/previous-session.jpg"));
      await user.click(
        within(dialog).getByRole("button", { name: /save progress/i }),
      );
      const key = samePO
        ? draftKey
        : draftKey.replace("live-po-1", "live-po-2");
      await waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(key)!).body.evidencePhotos,
        ).toEqual([]),
      );
    },
  );

  it("keeps unsaved scans editable and retries a transient save failure without reloading", async () => {
    const user = userEvent.setup();
    renderReceiving();
    const dialog = await openReceiving(user);
    const serials = within(dialog).getByLabelText(
      /clean serials for smart watches/i,
    );
    fireEvent.change(serials, { target: { value: "UNSAVED-1" } });
    const write = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === draftKey && fail) {
        fail = false;
        throw new Error("Temporary save failure");
      }
      return write.call(this, key, value);
    });
    await user.click(
      within(dialog).getByRole("button", { name: /save progress/i }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Temporary save failure",
    );
    expect(serials).toBeEnabled();
    expect(serials).toHaveValue("UNSAVED-1");
    fireEvent.change(serials, { target: { value: "UNSAVED-1\nUNSAVED-2" } });
    await user.click(
      within(dialog).getByRole("button", { name: /retry save/i }),
    );
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(draftKey)!).body.lines[0].serials.clean,
      ).toBe("UNSAVED-1\nUNSAVED-2"),
    );
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires explicit discard confirmation before reloading a conflicted draft", async () => {
    const user = userEvent.setup();
    liveDrafts.enabled = true;
    liveDrafts.rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === "save_receiving_draft"
          ? { status: "conflict", current_version: 2 }
          : draftRecord(2, savedProgress("REMOTE-1")),
    }));
    renderReceiving();
    const dialog = await openReceiving(user);
    const serials = within(dialog).getByLabelText(
      /clean serials for smart watches/i,
    );
    fireEvent.change(serials, { target: { value: "LOCAL-UNSAVED" } });
    await user.click(
      within(dialog).getByRole("button", { name: /save progress/i }),
    );
    expect(serials).toBeEnabled();
    expect(serials).toHaveValue("LOCAL-UNSAVED");
    const loads = () =>
      liveDrafts.rpc.mock.calls.filter(
        ([name]) => name === "load_receiving_draft",
      ).length;
    expect(loads()).toBe(1);
    await user.click(
      within(dialog).getByRole("button", { name: /^reload saved progress$/i }),
    );
    expect(serials).toHaveValue("LOCAL-UNSAVED");
    expect(loads()).toBe(1);
    await user.click(
      within(dialog).getByRole("button", { name: /keep editing/i }),
    );
    expect(serials).toHaveValue("LOCAL-UNSAVED");
    await user.click(
      within(dialog).getByRole("button", { name: /^reload saved progress$/i }),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: /discard unsaved changes and reload/i,
      }),
    );
    await waitFor(() => expect(serials).toHaveValue("REMOTE-1"));
    expect(loads()).toBe(2);
  });

  it.each(["append", "duplicate", "capacity"])(
    "uses current serials and quantities for a delayed camera %s",
    async (scenario) => {
      const user = userEvent.setup();
      renderReceiving();
      const dialog = await openReceiving(user);
      await user.click(
        within(dialog).getByRole("button", {
          name: "Scan clean serials for Smart watches",
        }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Start camera scan" }),
      );
      const clean = within(dialog).getByLabelText(
        /clean serials for smart watches/i,
      );
      fireEvent.change(clean, { target: { value: "MANUAL-1" } });
      if (scenario === "duplicate") {
        fireEvent.change(
          within(dialog).getByRole("spinbutton", {
            name: /damaged quantity for smart watches/i,
          }),
          { target: { value: "1" } },
        );
        fireEvent.change(
          within(dialog).getByLabelText(/damaged serials for smart watches/i),
          { target: { value: "OTHER-OUTCOME" } },
        );
      }
      if (scenario === "capacity") {
        fireEvent.change(
          within(dialog).getByRole("spinbutton", {
            name: /clean quantity for smart watches/i,
          }),
          { target: { value: "1" } },
        );
      }
      act(() =>
        camera.detected!(
          scenario === "duplicate" ? "OTHER-OUTCOME" : "CAMERA-2",
        ),
      );
      expect(clean).toHaveValue(
        scenario === "append" ? "MANUAL-1\nCAMERA-2" : "MANUAL-1",
      );
      if (scenario === "duplicate")
        expect(screen.getByText(/already scanned/i)).toBeInTheDocument();
      if (scenario === "capacity")
        expect(screen.getByText(/all required serials/i)).toBeInTheDocument();
    },
  );

  it("refreshes PO balances on opening before reconciling a saved draft, without a restore loop", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository();
    const rows = await repo.getReceivableProcurementPOs();
    const load = vi
      .spyOn(repo, "getReceivableProcurementPOs")
      .mockResolvedValue(rows);
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        poId: "live-po-1",
        version: 1,
        updatedAt: savedAt,
        body: savedProgress(),
      }),
    );
    renderReceiving(repo);
    await screen.findByText("PO-LIVE-001");
    const before = load.mock.calls.length;
    load.mockResolvedValue([
      { ...rows[0]!, lines: [{ ...rows[0]!.lines[0]!, receivedQuantity: 1 }] },
    ]);
    const dialog = await openReceiving(user);
    expect(
      within(dialog).getByRole("checkbox", { name: "Receive Smart watches" }),
    ).not.toBeChecked();
    expect(within(dialog).getByText(/1 expected/)).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
    ).toHaveValue("SAVED-1");
    expect(load.mock.calls.length).toBe(before + 1);
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Receive Smart watches" }),
    );
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "EDIT-AFTER-RESTORE" } },
    );
    expect(load.mock.calls.length).toBe(before + 1);
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
    ).toHaveValue("EDIT-AFTER-RESTORE");
  });

  it("blocks stale cached receiving when the opening refresh fails and allows an explicit retry", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository();
    const rows = await repo.getReceivableProcurementPOs();
    const load = vi
      .spyOn(repo, "getReceivableProcurementPOs")
      .mockResolvedValue(rows);
    renderReceiving(repo);
    await screen.findByText("PO-LIVE-001");
    load.mockRejectedValueOnce(new Error("PO refresh unavailable"));
    await user.click(
      screen.getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PO refresh unavailable",
    );
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: /reload saved progress/i }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText(/clean serials for smart watches/i),
      ).toBeEnabled(),
    );
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([0, 4])(
    "cleans up final receipts with draft version %i without erasing tombstone semantics",
    async (version) => {
      const user = userEvent.setup();
      const repo = new LiveProcurementRepository();
      liveDrafts.enabled = true;
      liveDrafts.rpc.mockImplementation(async (name: string) => {
        if (name === "delete_receiving_draft" && version === 0) {
          return {
            data: null,
            error: { message: "PO is no longer receivable" },
          };
        }
        return {
          error: null,
          data: draftRecord(
            name === "delete_receiving_draft" ? version + 1 : version,
          ),
        };
      });
      renderReceiving(repo);
      const dialog = await openReceiving(user);
      completeReceipt(dialog);
      await user.click(
        within(dialog).getByRole("button", {
          name: /confirm governed receipt/i,
        }),
      );
      await screen.findByText(
        "Procurement PO received into inspection staging",
      );
      const deletes = liveDrafts.rpc.mock.calls.filter(
        ([name]) => name === "delete_receiving_draft",
      );
      expect(deletes).toEqual(
        version === 0
          ? []
          : [
              [
                "delete_receiving_draft",
                { p_po_id: "live-po-1", p_expected_version: 4 },
              ],
            ],
      );
      expect(
        screen.queryByText(/saved progress could not be updated/i),
      ).not.toBeInTheDocument();
    },
  );

  it("reuses the receipt key after a committed receipt loses its response", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository();
    const receive = repo.receiveProcurementPO.bind(repo);
    let first = true;
    vi.spyOn(repo, "receiveProcurementPO").mockImplementation(async (input) => {
      const result = await receive(input);
      if (first) {
        first = false;
        throw new Error("Receipt response lost");
      }
      return result;
    });
    const initialReceipts = (await repo.getData()).receipts.length;
    renderReceiving(repo);
    const dialog = await openReceiving(user);
    completeReceipt(dialog);
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );
    await screen.findByText("Receipt response lost");
    expect((await repo.getData()).receipts).toHaveLength(initialReceipts + 1);
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );
    await waitFor(() => expect(repo.receivedInputs).toHaveLength(2));
    expect(repo.receivedInputs[1]!.idempotencyKey).toBe(
      repo.receivedInputs[0]!.idempotencyKey,
    );
    await screen.findByText("Procurement PO received into inspection staging");
    expect((await repo.getData()).receipts).toHaveLength(initialReceipts + 1);
  });

  it("uses a new receipt key when a failed attempt is edited before retrying", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository();
    const receive = vi.spyOn(repo, "receiveProcurementPO");
    receive.mockRejectedValueOnce(new Error("Receipt rejected before commit"));
    renderReceiving(repo);
    const dialog = await openReceiving(user);
    completeReceipt(dialog);
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );
    await screen.findByText("Receipt rejected before commit");
    fireEvent.change(within(dialog).getByLabelText(/delivery evidence url/i), {
      target: { value: "evidence/corrected-delivery.jpg" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );
    await screen.findByText("Procurement PO received into inspection staging");
    expect(receive.mock.calls[1]![0].idempotencyKey).not.toBe(
      receive.mock.calls[0]![0].idempotencyKey,
    );
    expect(repo.receivedInputs[0]!.evidenceUrls).toEqual([
      "evidence/corrected-delivery.jpg",
    ]);
  });

  it("saves incomplete serial progress and restores it without receiving stock", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(2);
    const view = renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    const open = async () => {
      await user.click(
        within(await screen.findByLabelText("Purchase orders")).getByRole(
          "button",
          { name: /^receive and inspect$/i },
        ),
      );
      return screen.findByRole("dialog", {
        name: /receive approved procurement po/i,
      });
    };
    let dialog = await open();
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "PROGRESS-1" } },
    );
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: /save progress/i }),
    );
    await screen.findByText(/receiving progress saved/i);
    expect(repo.receivedInputs).toHaveLength(0);
    view.unmount();
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    dialog = await open();
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText(/clean serials for smart watches/i),
      ).toHaveValue("PROGRESS-1"),
    );
    expect(repo.receivedInputs).toHaveLength(0);
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
  });

  it("lets another operator's SKU wait while submitting only the selected line", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(2, true);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    await user.click(
      within(await screen.findByLabelText("Purchase orders")).getByRole(
        "button",
        { name: /^receive and inspect$/i },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Receive Second SKU" }),
    );
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "SUBSET-1\nSUBSET-2" } },
    );
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/subset.jpg",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );
    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]?.lines.map((line) => line.lineId)).toEqual([
      "live-line-1",
    ]);
  });

  it("scans serials into the selected outcome and rejects duplicate scans and insecure evidence", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(2);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    await user.click(
      within(await screen.findByLabelText("Purchase orders")).getByRole(
        "button",
        { name: /^receive and inspect$/i },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "Scan clean serials for Smart watches",
      }),
    );
    const scanner = within(dialog).getByLabelText(
      "Serial for clean Smart watches",
    );
    await user.type(scanner, "SCANNED-1{Enter}");
    await user.type(scanner, "SCANNED-1{Enter}");
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
    ).toHaveValue("SCANNED-1");
    expect(screen.getByText(/already scanned/i)).toBeInTheDocument();
    await user.type(scanner, "SCANNED-2{Enter}");
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "http://deliverylink.com/OTG-L",
    );
    expect(
      within(dialog).getByText(/use a secure https link/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", {
        name: /upload or photograph delivery note/i,
      }),
    ).toBeInTheDocument();
    expect(repo.receivedInputs).toHaveLength(0);
  });

  it("does not expose PO authoring or cancellation to the Operator", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    expect(
      screen.queryByRole("button", { name: /new po/i }),
    ).not.toBeInTheDocument();
    await user.click(within(list).getAllByRole("button")[0]!);
    expect(
      screen.queryByRole("button", { name: /cancel po/i }),
    ).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("lists seeded purchase orders with human PO numbers", async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    expect(
      within(list).getAllByText(/mWellness Wearables/i).length,
    ).toBeGreaterThan(0);
    expect(within(list).getByText(/MetroPrint Apparel/i)).toBeInTheDocument();
    // No raw ids as labels (WH-26) — stable PO-#### numbers instead.
    expect(within(list).queryByText(/po-wearables/i)).not.toBeInTheDocument();
    expect(within(list).getAllByText(/PO-\d{4}/).length).toBeGreaterThan(0);
  });

  it("filters purchase orders by status", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    await screen.findByLabelText("Purchase orders");

    await user.click(screen.getByRole("tab", { name: /^closed$/i }));
    const list = screen.getByLabelText("Purchase orders");
    expect(within(list).getByText(/GiftWorks/i)).toBeInTheDocument();
    expect(
      within(list).queryByText(/mWellness Wearables/i),
    ).not.toBeInTheDocument();
  });

  it("never exposes raw Warehouse PO authoring", async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    await screen.findByLabelText("Purchase orders");
    expect(
      screen.queryByRole("button", { name: /new po/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open procurement requests/i }),
    ).toHaveAttribute("href", "/procurement/requests");
  });

  it("receives stock via the PO detail sheet (row is the target)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    // Open the ordered wearables PO from its row.
    await user.click(
      within(list).getAllByRole("button", { name: /mWellness Wearables/i })[0]!,
    );
    const detail = await screen.findByRole("dialog", {
      name: /mWellness Wearables/i,
    });
    await user.click(
      within(detail).getByRole("button", { name: /^receive and inspect$/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: /receive against po/i,
    });
    expect(
      within(dialog).getByText(/inspection required/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /confirm receipt/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/received against po into inspection staging/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /open quality queue/i }),
    ).toBeInTheDocument();
  });

  it("does not offer Receive on a draft PO (WH-25)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    // The seeded draft PO (sleep rings + OTG bags from mWellness Wearables).
    const draftRow = within(list)
      .getAllByRole("button")
      .find((b) => /draft/i.test(b.textContent ?? ""));
    expect(draftRow).toBeDefined();
    await user.click(draftRow!);
    const detail = await screen.findByRole("dialog", {
      name: /mWellness Wearables/i,
    });
    expect(
      within(detail).queryByRole("button", { name: /^receive$/i }),
    ).not.toBeInTheDocument();
    expect(within(detail).getByText(/not yet ordered/i)).toBeInTheDocument();
  });

  it("cancels an open purchase order after an explicit confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    const list = await screen.findByLabelText("Purchase orders");

    await user.click(
      within(list).getAllByRole("button", { name: /MetroPrint Apparel/i })[0]!,
    );
    const detail = await screen.findByRole("dialog", {
      name: /MetroPrint Apparel/i,
    });
    await user.click(
      within(detail).getByRole("button", { name: /cancel po/i }),
    );
    await user.click(
      within(detail).getByRole("button", { name: /confirm cancel/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/purchase order cancelled/i)).toBeInTheDocument();
    });
  });

  it("keeps procurement-issued PO links inside the Warehouse workflow", async () => {
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-9",
          poNumber: "PO-2026-0003",
          vendorId: "ven-acme",
          vendorName: "Acme Medical Supplies",
          status: "issued",
          origin: "request",
          lines: [
            {
              id: "l1",
              description: "Barcode scanners",
              quantity: 4,
              unitPrice: 650000,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-05T10:00:00.000Z",
          updatedAt: "2026-07-05T10:00:00.000Z",
          total: 2600000,
        },
      ]),
    );
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    expect(within(list).getByText("From Procurement")).toBeInTheDocument();
    const link = within(list).getByRole("link", { name: "PO-2026-0003" });
    expect(link).toHaveAttribute("href", "/warehouse/purchase-orders?po=ppo-9");
    expect(link).toHaveClass("min-h-11");
    expect(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(/Acme Medical Supplies/i),
    ).toBeInTheDocument();
  });

  it("opens a per-line governed receipt breakdown from the Procurement handoff query", async () => {
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-handoff",
          poNumber: "PO-HANDOFF-001",
          vendorName: "Handoff Vendor",
          status: "issued",
          lines: [
            {
              id: "line-handoff",
              productId: "smart-watch",
              description: "Smart watches",
              quantity: 2,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-15T00:00:00.000Z",
          total: 0,
        },
      ]),
    );

    renderWithProviders(<PurchaseOrdersPage />, {
      role: "warehouse_operator",
      route: "/purchase-orders?po=ppo-handoff",
    });

    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("PO-HANDOFF-001")).toBeInTheDocument();
    for (const outcome of [
      "Clean",
      "Damaged",
      "Unidentified",
      "Short",
      "Excess",
    ]) {
      expect(
        within(dialog).getByRole("spinbutton", {
          name: new RegExp(`${outcome} quantity for Smart watches`, "i"),
        }),
      ).toBeInTheDocument();
    }
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
    ).toBeInTheDocument();
  });

  it("captures unidentified custody without forcing a Warehouse product mapping", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-unidentified",
          poNumber: "PO-UNIDENTIFIED-001",
          vendorName: "Unknown Load Vendor",
          status: "issued",
          lines: [
            {
              id: "line-unidentified",
              description: "Expected diagnostic kit",
              quantity: 2,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-15T00:00:00.000Z",
          total: 0,
        },
      ]),
    );

    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    const unidentified = within(dialog).getByRole("spinbutton", {
      name: /unidentified quantity for expected diagnostic kit/i,
    });
    await user.clear(unidentified);
    await user.type(unidentified, "2");

    expect(
      within(dialog).getByLabelText(
        /observed description for expected diagnostic kit/i,
      ),
    ).toHaveValue("Expected diagnostic kit");
    expect(
      within(dialog).getByLabelText(
        /observed identifiers for expected diagnostic kit/i,
      ),
    ).toBeInTheDocument();
  });

  it("submits a PO-0001 mixed serialized receipt as one governed command", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(100);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });

    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });

    const setQuantity = async (outcome: string, quantity: number) => {
      const input = within(dialog).getByRole("spinbutton", {
        name: new RegExp(`${outcome} quantity for Smart watches`, "i"),
      });
      fireEvent.change(input, { target: { value: String(quantity) } });
    };
    await setQuantity("Clean", 50);
    await setQuantity("Damaged", 20);
    await setQuantity("Unidentified", 10);
    await setQuantity("Short", 20);

    const serials = (prefix: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`,
      );
    const cleanSerials = serials("CLEAN", 50);
    const damagedSerials = serials("DAMAGED", 20);
    const unidentifiedSerials = serials("UNKNOWN", 10);
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: cleanSerials.join("\n") } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/damaged serials for smart watches/i),
      { target: { value: damagedSerials.join("\n") } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/unidentified serials for smart watches/i),
      { target: { value: unidentifiedSerials.join("\n") } },
    );
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/po-0001-delivery.jpg",
    );
    await user.type(
      within(dialog).getByLabelText(/exception reason/i),
      "Mixed delivery condition documented at receiving",
    );

    expect(
      within(dialog).getByText(/80 physical.*20 short.*0 excess/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );

    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]).toMatchObject({
      mode: "breakdown",
      poId: "live-po-1",
      locationId: "loc-wh",
      exceptionReason: "Mixed delivery condition documented at receiving",
      lines: [
        {
          mode: "breakdown",
          lineId: "live-line-1",
          productId: "smart-watch",
          expectedQuantity: 100,
          outcomes: {
            clean: { quantity: 50, serialNumbers: cleanSerials },
            damaged: { quantity: 20, serialNumbers: damagedSerials },
            unidentified: {
              quantity: 10,
              serialNumbers: unidentifiedSerials,
              observedDescription: "Smart watches",
            },
            short: { quantity: 20 },
            excess: { quantity: 0, serialNumbers: [] },
          },
        },
      ],
      evidenceUrls: ["evidence/po-0001-delivery.jpg"],
    });
  });

  it("blocks a receipt whose outcomes do not reconcile to the expected balance", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(100);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    const clean = within(dialog).getByRole("spinbutton", {
      name: /clean quantity for smart watches/i,
    });
    fireEvent.change(clean, { target: { value: "79" } });
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/mismatch.jpg",
    );

    expect(
      within(dialog).getByText(
        /outcomes must reconcile to 100 expected units/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    expect(repo.receivedInputs).toHaveLength(0);
  });

  it("blocks duplicate serialized identities across physical outcomes", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(2);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    const clean = within(dialog).getByRole("spinbutton", {
      name: /clean quantity for smart watches/i,
    });
    const damaged = within(dialog).getByRole("spinbutton", {
      name: /damaged quantity for smart watches/i,
    });
    fireEvent.change(clean, { target: { value: "1" } });
    fireEvent.change(damaged, { target: { value: "1" } });
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "DUPLICATE-001" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/damaged serials for smart watches/i),
      { target: { value: "DUPLICATE-001" } },
    );

    expect(
      within(dialog).getByText(
        /serial numbers must be unique across outcomes/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    expect(repo.receivedInputs).toHaveLength(0);
  });

  it("uses the live handoff in Supabase mode and ignores local cached POs", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "cached-po",
          poNumber: "PO-CACHED",
          vendorName: "Cached Vendor",
          status: "issued",
          lines: [],
          createdAt: "2026-07-01T00:00:00Z",
        },
      ]),
    );
    const repo = new LiveProcurementRepository();
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });

    const list = await screen.findByLabelText("Purchase orders");
    expect(
      screen.queryByRole("link", { name: /open quality queue/i }),
    ).not.toBeInTheDocument();
    expect(within(list).getByText("PO-LIVE-001")).toBeInTheDocument();
    expect(
      within(list).queryByText(/mWellness Wearables/i),
    ).not.toBeInTheDocument();
    expect(within(list).queryByText("PO-CACHED")).not.toBeInTheDocument();
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/live.jpg",
    );
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "LIVE-001\nLIVE-002" } },
    );
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );

    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]).toMatchObject({
      poId: "live-po-1",
      locationId: "loc-wh",
    });
  });
});
