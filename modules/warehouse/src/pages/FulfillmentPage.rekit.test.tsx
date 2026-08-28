import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { buildSeed } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/components/camera/scanEngine", () => ({
  createScanEngine: () => ({
    start: async () => {
      throw new Error("Camera denied");
    },
    stop: vi.fn(),
  }),
}));

function fixture() {
  const data = buildSeed();
  data.locations = [
    { id: "loc-wh", name: "Main warehouse", type: "warehouse", active: true },
    {
      id: "other-wh",
      name: "Other warehouse",
      type: "warehouse",
      active: true,
    },
  ];
  data.storageAreas = [
    { id: "bin-a", locationId: "loc-wh", code: "MAIN-A", active: true },
    { id: "bin-b", locationId: "loc-wh", code: "MAIN-B", active: true },
    { id: "bin-other", locationId: "other-wh", code: "OTHER-A", active: true },
  ];
  data.units = [
    {
      id: "unit-a",
      productId: "smart-watch",
      serialNumber: "WATCH-A",
      locationId: "loc-wh",
      binId: "bin-a",
      status: "returned",
    },
    {
      id: "unit-b",
      productId: "smart-watch",
      serialNumber: "WATCH-B",
      locationId: "loc-wh",
      binId: "bin-b",
      status: "in_stock",
    },
    {
      id: "unit-c",
      productId: "sleep-ring",
      serialNumber: "RING-A",
      locationId: "loc-wh",
      binId: "bin-a",
      status: "in_stock",
    },
    {
      id: "unit-d",
      productId: "smart-watch",
      serialNumber: "WATCH-HELD",
      locationId: "loc-wh",
      binId: "bin-a",
      status: "pending_inspection",
    },
  ];
  data.customerReturnCases = [
    {
      id: "return-a",
      productId: "smart-watch",
      serialNumber: "WATCH-A",
      defectDescription: "Open box",
      requestingDepartment: "customer_service",
      status: "resolved",
      resolution: "re_kit",
      createdBy: "reviewer",
      createdAt: "2026-08-28T00:00:00Z",
    },
  ];
  data.kitDefinitions = [
    {
      id: "kit-a",
      productId: "smart-watch",
      name: "Open-box watch",
      version: 1,
      components: [
        {
          productId: "smart-watch",
          quantity: 1,
          serializationPolicy: "required",
        },
      ],
      status: "active",
      ownerDepartment: "product",
      productApprovalReference: "PROD-1",
      createdBy: "product",
      createdAt: "2026-08-28T00:00:00Z",
    },
  ];
  data.reKitWorkOrders = [];
  return data;
}

function scan(dialog: HTMLElement, label: string, value: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

async function openRekit(data = fixture()) {
  const repo = makeRepo(data);
  renderWithProviders(<FulfillmentPage />, {
    repo,
    role: "warehouse_supervisor",
    route: "/fulfillment?tab=kits",
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Create re-kit work order" }),
  );
  return {
    repo,
    dialog: await screen.findByRole("dialog", {
      name: "Create re-kit work order",
    }),
  };
}

describe("Re-kit guided identity capture", () => {
  it("recovers from denied camera access with validated keyboard entry and preserves lineage", async () => {
    const { repo, dialog } = await openRekit();
    const create = vi.spyOn(repo, "createReKitWorkOrder");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Scan output serial" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Scanning needs camera access",
    );
    scan(dialog, "Enter output serial manually", "  OPENBOX-A  ");
    scan(dialog, "Enter re-kit source bin manually", "MAIN-A");
    scan(dialog, "Enter component serial manually", "WATCH-A");
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create work order" }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        outputSerialNumber: "OPENBOX-A",
        componentSerialNumbers: ["WATCH-A"],
        sourceReturnCaseId: "return-a",
        kitDefinitionId: "kit-a",
      }),
    );
    await waitFor(async () =>
      expect((await repo.getData()).reKitWorkOrders).toHaveLength(1),
    );
  });

  it("rejects wrong bins, products, held stock, unknown and duplicate serials before commit", async () => {
    const { repo, dialog } = await openRekit();
    const create = vi.spyOn(repo, "createReKitWorkOrder");
    scan(dialog, "Enter output serial manually", "WATCH-A");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "output serial already exists",
    );
    scan(dialog, "Enter output serial manually", "OPENBOX-A");
    scan(dialog, "Enter component serial manually", "WATCH-A");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "source rack or bin",
    );
    scan(dialog, "Enter re-kit source bin manually", "OTHER-A");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "selected warehouse",
    );
    scan(dialog, "Enter re-kit source bin manually", "MAIN-A");
    for (const [serial, message] of [
      ["UNKNOWN", "Serial not found"],
      ["RING-A", "not a serialized component"],
      ["WATCH-B", "different warehouse or bin"],
      ["WATCH-HELD", "not eligible"],
    ]) {
      scan(dialog, "Enter component serial manually", serial!);
      expect(within(dialog).getByRole("alert")).toHaveTextContent(message!);
      expect(
        within(dialog).getByRole("button", { name: "Create work order" }),
      ).toBeDisabled();
    }
    scan(dialog, "Enter component serial manually", "WATCH-A");
    scan(dialog, "Enter component serial manually", "WATCH-A");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "already captured",
    );
    expect(
      within(dialog).getByRole("list", { name: "Captured component serials" })
        .children,
    ).toHaveLength(1);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove component WATCH-A" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Create work order" }),
    ).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("captures components from separate verified bins and clears scans when the recipe changes", async () => {
    const data = fixture();
    data.kitDefinitions[0]!.components[0]!.quantity = 2;
    data.kitDefinitions.push({
      ...data.kitDefinitions[0]!,
      id: "kit-b",
      name: "Another recipe",
    });
    const { dialog } = await openRekit(data);
    scan(dialog, "Enter output serial manually", "OPENBOX-A");
    scan(dialog, "Enter re-kit source bin manually", "MAIN-A");
    scan(dialog, "Enter component serial manually", "WATCH-A");
    expect(
      within(dialog).getByRole("button", { name: "Create work order" }),
    ).toBeDisabled();
    scan(dialog, "Enter re-kit source bin manually", "MAIN-B");
    scan(dialog, "Enter component serial manually", "WATCH-B");
    expect(
      within(dialog).getByRole("button", { name: "Create work order" }),
    ).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText("Active kit definition"), {
      target: { value: "kit-b" },
    });
    expect(
      within(dialog).getByLabelText("Captured output serial"),
    ).toHaveTextContent("No output serial captured");
    expect(
      within(dialog).getByRole("list", { name: "Captured component serials" })
        .children,
    ).toHaveLength(0);
  });

  it("requires a matching destination-bin scan to complete a re-kit", async () => {
    const data = fixture();
    data.reKitWorkOrders = [
      {
        id: "work-a",
        sourceReturnCaseId: "return-a",
        kitDefinitionId: "kit-a",
        outputSerialNumber: "OPENBOX-A",
        componentSerialNumbers: ["WATCH-A"],
        condition: "open_box",
        status: "inspection",
        createdBy: "operator",
        createdAt: "2026-08-28T00:00:00Z",
      },
    ];
    const repo = makeRepo(data);
    renderWithProviders(<FulfillmentPage />, {
      repo,
      role: "warehouse_supervisor",
      route: "/fulfillment?tab=kits",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Complete re-kit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Complete re-kit",
    });
    scan(dialog, "Enter destination bin manually", "OTHER-A");
    expect(
      within(dialog).getByRole("button", { name: "Post open-box stock" }),
    ).toBeDisabled();
    scan(dialog, "Enter destination bin manually", "MAIN-B");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Post open-box stock" }),
    );
    await waitFor(async () =>
      expect((await repo.getData()).units).toContainEqual(
        expect.objectContaining({ serialNumber: "OPENBOX-A", binId: "bin-b" }),
      ),
    );
  });
});
