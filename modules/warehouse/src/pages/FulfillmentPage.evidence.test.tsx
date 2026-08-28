import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { uploadEvidence } from "@/data/supabase/evidence";

vi.mock("@/data/createRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/createRepository")>()),
  resolveDataSource: () => "supabase",
}));
vi.mock("@/data/supabase/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/supabase/evidence")>()),
  uploadEvidence: vi.fn(),
}));

function deferred() {
  let resolve!: (path: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openAction(kind: "pick" | "pack" | "delivery") {
  const seedRepo = makeRepo();
  const order = await seedRepo.createFulfillmentOrder({
    source: "department_request",
    externalReference: "UPLOAD-ORDER",
    requestingDepartment: "marketing",
    sourceLocationId: "loc-wh",
    lines: [
      { productId: "doctor-token", quantity: 1 },
      { productId: "shirt-l", quantity: 1 },
    ],
    actor: "requester",
  });
  const data = await seedRepo.getData();
  data.stockLevels = [
    { productId: "doctor-token", locationId: "loc-wh", quantity: 20 },
    { productId: "shirt-l", locationId: "loc-wh", quantity: 20 },
  ];
  data.fulfillmentOrders[0]!.status =
    kind === "pick" ? "picking" : kind === "pack" ? "packing" : "released";
  if (kind === "delivery") {
    data.fulfillmentOrders[0]!.deliveryMethod = "shipment";
    data.fulfillmentOrders[0]!.shipmentStatus = "dispatched";
  }
  const repo = makeRepo(data);
  const advance = vi
    .spyOn(repo, "advanceFulfillmentOrder")
    .mockResolvedValue(order);
  renderWithProviders(<FulfillmentPage />, {
    repo,
    role: "warehouse_operator",
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name:
        kind === "pick"
          ? "Confirm scanned pick"
          : kind === "pack"
            ? "Prepare accountable handover"
            : "Update delivery",
    }),
  );
  const dialog = await screen.findByRole("dialog");
  if (kind === "pack")
    fireEvent.change(within(dialog).getByLabelText("Recipient name"), {
      target: { value: "Maya Santos" },
    });
  if (kind === "delivery") {
    fireEvent.change(within(dialog).getByLabelText("Delivery outcome"), {
      target: { value: "confirm_delivery" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Proof-of-delivery reference"),
      { target: { value: "POD-1" } },
    );
  }
  return { dialog, advance };
}

function upload(dialog: HTMLElement, label: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: {
      files: [new File(["photo"], "evidence.jpg", { type: "image/jpeg" })],
    },
  });
}

describe("Fulfillment evidence commit gates", () => {
  beforeEach(() => vi.mocked(uploadEvidence).mockReset());

  it("waits for every pick-line upload, including direct form submission", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(uploadEvidence)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { dialog, advance } = await openAction("pick");
    upload(dialog, "Attach pick evidence for Doctor Token");
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1));
    upload(dialog, "Attach pick evidence for Event Shirt (L)");
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(2));
    expect(
      within(dialog).getByRole("button", { name: "Uploading evidence..." }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await act(async () => first.resolve("pick/first.jpg"));
    expect(
      within(dialog).getByRole("button", { name: "Uploading evidence..." }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await act(async () => second.resolve("pick/second.jpg"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm pick" }),
    );
    await waitFor(() => expect(advance).toHaveBeenCalledOnce());
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({
        pickedLines: [
          expect.objectContaining({ evidenceUrl: "pick/first.jpg" }),
          expect.objectContaining({ evidenceUrl: "pick/second.jpg" }),
        ],
      }),
    );
  });

  it("blocks packing while an optional handover photo uploads", async () => {
    const pending = deferred();
    vi.mocked(uploadEvidence).mockReturnValue(pending.promise);
    const { dialog, advance } = await openAction("pack");
    upload(dialog, "Attach handover photo (optional)");
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByRole("button", { name: "Uploading evidence..." }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await act(async () => pending.resolve("handover/photo.jpg"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm packing" }),
    );
    await waitFor(() => expect(advance).toHaveBeenCalledOnce());
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({ handoverEvidenceUrl: "handover/photo.jpg" }),
    );
  });

  it("keeps delivery blocked after a failed upload and accepts a successful retry", async () => {
    const pending = deferred();
    vi.mocked(uploadEvidence).mockReturnValueOnce(pending.promise);
    const { dialog, advance } = await openAction("delivery");
    upload(dialog, "Upload proof-of-delivery image");
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByRole("button", { name: "Uploading evidence..." }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("Connection lost")));
    expect(
      within(dialog).getByRole("button", { name: "Save delivery update" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Connection lost",
    );
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    vi.mocked(uploadEvidence).mockResolvedValueOnce("delivery/proof.jpg");
    upload(dialog, "Upload proof-of-delivery image");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save delivery update" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save delivery update" }),
    );
    await waitFor(() => expect(advance).toHaveBeenCalledOnce());
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({ trackingEvidenceUrl: "delivery/proof.jpg" }),
    );
  });

  it("does not retain pending delivery evidence after closing and reopening the action", async () => {
    const pending = deferred();
    vi.mocked(uploadEvidence).mockReturnValue(pending.promise);
    const { dialog, advance } = await openAction("delivery");
    upload(dialog, "Upload proof-of-delivery image");
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Update delivery" }),
    );
    const reopened = await screen.findByRole("dialog");
    fireEvent.change(within(reopened).getByLabelText("Delivery outcome"), {
      target: { value: "confirm_delivery" },
    });
    await act(async () => pending.resolve("delivery/old.jpg"));
    expect(
      within(reopened).getByRole("button", { name: "Save delivery update" }),
    ).toBeDisabled();
    expect(
      within(reopened).queryByRole("list", { name: "Captured evidence" }),
    ).not.toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});
