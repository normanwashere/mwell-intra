import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainingContextValue } from "@intra/learning";
import { ReceivingPage, ReceivingPageSurface } from "./ReceivingPage";
import type { ReceivingTrainingState } from "@/training/receivingAdapter";
import {
  certifiedTestLearning,
  makeRepo,
  renderWithProviders,
} from "@/test/renderWithProviders";
import { availableForProduct } from "@/domain/stock";

async function evidenceDirectReceipt(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Exception reason"),
    "Approved emergency replenishment",
  );
  await user.upload(
    screen.getByLabelText("Capture photo evidence"),
    new File(["approval"], "approved-exception.jpg", { type: "image/jpeg" }),
  );
}

describe("ReceivingPage", () => {
  it("makes direct receiving an evidenced exception after the PO-first route", async () => {
    renderWithProviders(<ReceivingPage />);

    expect(
      await screen.findByText(/approved purchase orders are the standard receiving route/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Receipt exception type")).toHaveValue("non_po");
    expect(screen.getByLabelText("Exception reason")).toBeInTheDocument();
  });

  it("rehydrates only an existing governed practice attempt after reload", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ReceivingPage />, {
      route: "/receiving?training=warehouse-receiving-v1",
      learning: {
        ...certifiedTestLearning,
        resume,
        snapshot: {
          ...certifiedTestLearning.snapshot!,
          curricula: [
            {
              curriculum: {
                id: "warehouse-operator",
                version: 1,
                personaId: "warehouse-operator",
                audience: "internal",
                requirementIds: ["receiving-practice"],
              },
              source: "role",
              requirements: [
                {
                  id: "receiving-practice",
                  version: 1,
                  audience: "internal",
                  kind: "scenario",
                  title: "Warehouse receiving capability practice",
                  mandatory: true,
                  prerequisiteIds: [],
                  capabilityOutcomes: [
                    { module: "warehouse", capability: "receive_stock" },
                  ],
                  simulationId: "warehouse-receiving-v1",
                },
              ],
            },
          ],
          progress: [
            {
              assignmentRequirementId: "assignment-receiving",
              requirementId: "receiving-practice",
              requirementVersion: 1,
              state: "in_progress",
              attemptCount: 1,
              allowsSharedCompletion: false,
              activeAttempt: {
                id: "attempt-receiving",
                attemptNumber: 1,
                mode: "scenario",
                startedAt: "2026-08-13T00:00:00.000Z",
              },
              updatedAt: "2026-08-13T00:00:00.000Z",
            },
          ],
        },
      },
    });

    expect(
      await screen.findByText("Restoring receiving practice…"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(resume).toHaveBeenCalledWith("receiving-practice"),
    );
  });

  it("does not expose the live form for a training URL without an active attempt", async () => {
    renderWithProviders(<ReceivingPage />, {
      route: "/receiving?training=warehouse-receiving-v1",
    });

    expect(
      await screen.findByText("Complete onboarding before this action"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Receiving" }),
    ).not.toBeInTheDocument();
  });

  it("cannot call the live receiving repository from a training surface", async () => {
    const repo = makeRepo();
    const before = (await repo.getData()).receipts.length;
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const training = {
      currentStep: { id: "line" },
      dispatch,
      busy: false,
    } as unknown as TrainingContextValue<ReceivingTrainingState>;
    const user = userEvent.setup();

    renderWithProviders(<ReceivingPageSurface training={training} />, { repo });
    await screen.findByText(/practice purchase order/i);
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    expect(
      within(
        await screen.findByRole("table", { name: "Receipt lines" }),
      ).getByText(/Smart Watch/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    expect(dispatch).toHaveBeenLastCalledWith({ type: "submit-receipt" });
    expect((await repo.getData()).receipts).toHaveLength(before);
  });

  it("hides downstream links that a minimal live receiving bundle cannot open", async () => {
    renderWithProviders(<ReceivingPage />, {
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    await screen.findByRole("heading", { name: "Receiving" });
    expect(
      screen.getByRole("link", { name: /approved POs/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /continue to put away/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /open quality queue/i }),
    ).not.toBeInTheDocument();
  });

  it.each(["warehouse_operator", "warehouse_supervisor"] as const)(
    "renders the receiving surface for canonical %s",
    async (role) => {
      renderWithProviders(<ReceivingPage />, { role });
      expect(
        await screen.findByRole("heading", { name: "Receiving" }),
      ).toBeInTheDocument();
    },
  );

  it("states that a clean inspected receipt continues directly to putaway", async () => {
    renderWithProviders(<ReceivingPage />, { role: "warehouse_operator" });
    expect(await screen.findByText(/clean receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/no supervisor approval/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /continue to put away/i }),
    ).toHaveAttribute("href", "/storage");
  });

  it("adds a scanned product to the receipt and persists on submit", async () => {
    const repo = makeRepo();
    const before = availableForProduct(
      await repo.getStockState(),
      "ecg-ring-10",
    );
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });

    await screen.findByText(/receipt lines/i);
    expect(screen.getByText(/inspection required/i)).toBeInTheDocument();

    // Scan a known barcode via the manual fallback
    await user.type(
      screen.getByLabelText(/enter barcode manually/i),
      "480001001",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    const lines = screen.getByLabelText("Receipt lines");
    expect(
      within(lines).getByText(/ECG Ring \(Size 10\)/i),
    ).toBeInTheDocument();
    expect(await screen.findByText(/added ecg ring/i)).toBeInTheDocument();
    await evidenceDirectReceipt(user);

    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    await waitFor(async () => {
      const after = availableForProduct(
        await repo.getStockState(),
        "ecg-ring-10",
      );
      expect(after).toBe(before);
    });
    expect(await screen.findByText(/received .*item/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open quality queue/i }),
    ).toBeInTheDocument();
  });

  it("adds a non-serialized product with a chosen quantity and allows editing the line", async () => {
    const repo = makeRepo();
    const before = availableForProduct(
      await repo.getStockState(),
      "doctor-token",
    );
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);

    await user.selectOptions(screen.getByLabelText("Product"), "doctor-token");

    // Bump the "to add" quantity from 1 → 5 via the stepper, then add.
    const addIncrease = screen.getByRole("button", { name: "Increase" });
    for (let i = 0; i < 4; i++) await user.click(addIncrease);
    expect(screen.getByLabelText("Quantity to add")).toHaveValue(5);
    await user.click(screen.getByRole("button", { name: /add to receipt/i }));

    // Line shows an editable quantity; bump it to 6.
    const lines = screen.getByLabelText("Receipt lines");
    const lineQty = within(lines).getByLabelText("Quantity for Doctor Token");
    expect(lineQty).toHaveValue(5);
    await user.click(within(lines).getByRole("button", { name: "Increase" }));
    expect(lineQty).toHaveValue(6);
    await evidenceDirectReceipt(user);

    await user.click(screen.getByRole("button", { name: /receive .*item/i }));
    await waitFor(async () => {
      const after = availableForProduct(
        await repo.getStockState(),
        "doctor-token",
      );
      expect(after).toBe(before);
    });
  });

  it("reuses the receipt idempotency key after an uncertain response", async () => {
    const repo = makeRepo();
    const receiveOnce = repo.receiveStock.bind(repo);
    const receive = vi
      .spyOn(repo, "receiveStock")
      .mockRejectedValueOnce(new Error("Response was lost"))
      .mockImplementation((input) => receiveOnce(input));
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);

    await user.selectOptions(screen.getByLabelText("Product"), "doctor-token");
    await user.click(screen.getByRole("button", { name: /add to receipt/i }));
    await evidenceDirectReceipt(user);
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));
    await screen.findByText(/response was lost/i);
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    expect(receive.mock.calls[0]![0].idempotencyKey).toMatch(/^receive-/);
    expect(receive.mock.calls[1]![0].idempotencyKey).toBe(
      receive.mock.calls[0]![0].idempotencyKey,
    );
  });

  it("restores the pending receipt idempotency key after a page remount", async () => {
    window.sessionStorage.clear();
    const repo = makeRepo();
    const receiveOnce = repo.receiveStock.bind(repo);
    const receive = vi
      .spyOn(repo, "receiveStock")
      .mockRejectedValueOnce(new Error("Response was lost"))
      .mockImplementation((input) => receiveOnce(input));
    const user = userEvent.setup();
    const first = renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);
    await user.selectOptions(screen.getByLabelText("Product"), "doctor-token");
    await user.click(screen.getByRole("button", { name: /add to receipt/i }));
    await evidenceDirectReceipt(user);
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));
    await screen.findByText(/response was lost/i);
    const originalKey = receive.mock.calls[0]![0].idempotencyKey;
    first.unmount();

    const resumedUser = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);
    await resumedUser.selectOptions(
      screen.getByLabelText("Product"),
      "doctor-token",
    );
    await resumedUser.click(
      screen.getByRole("button", { name: /add to receipt/i }),
    );
    await evidenceDirectReceipt(resumedUser);
    await resumedUser.click(
      screen.getByRole("button", { name: /receive .*item/i }),
    );

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    expect(receive.mock.calls[1]![0].idempotencyKey).toBe(originalKey);
    expect(
      window.sessionStorage.getItem(
        "intra.warehouse.pending-receipt-command.v1",
      ),
    ).toBeNull();
  });

  it("warns when scanning an unknown barcode without a product selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo: makeRepo() });
    await screen.findByText(/receipt lines/i);

    await user.type(screen.getByLabelText(/enter barcode manually/i), "ZZZ999");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/unknown barcode/i)).toBeInTheDocument();
  });

  it("captures an expiry date for expiry-tracked stock", async () => {
    const seed = await makeRepo().getData();
    seed.products = seed.products.map((product) =>
      product.id === "doctor-token"
        ? { ...product, expiryTracked: true, shelfLifeWarningDays: 30 }
        : product,
    );
    const repo = makeRepo(seed);
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);

    await user.selectOptions(screen.getByLabelText("Product"), "doctor-token");
    await user.click(screen.getByRole("button", { name: /add to receipt/i }));
    await user.type(
      screen.getByLabelText("Expiry date for Doctor Token"),
      "2027-12-31",
    );
    await evidenceDirectReceipt(user);
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    await waitFor(async () => {
      const receivedLot = (await repo.getData()).lots.find(
        (lot) =>
          lot.productId === "doctor-token" && lot.expiryDate === "2027-12-31",
      );
      expect(receivedLot).toBeDefined();
    });
  });

  it("captures the actual delivery, batch, and device test controls", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<ReceivingPage />, { repo });
    await screen.findByText(/receipt lines/i);

    await user.clear(screen.getByLabelText("Actual delivery date"));
    await user.type(
      screen.getByLabelText("Actual delivery date"),
      "2026-07-21",
    );
    await user.type(screen.getByLabelText("Delivery reference"), "DR-1001");
    await user.type(screen.getByLabelText("Courier or driver"), "Juan / LBC");
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.type(
      screen.getByLabelText(/enter barcode manually/i),
      "SMART-WATCH-NEW-001",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await user.type(screen.getByLabelText("Batch number"), "BATCH-2026-07");
    await user.selectOptions(
      screen.getByLabelText("Device test result"),
      "passed",
    );
    await evidenceDirectReceipt(user);
    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    await waitFor(async () => {
      expect((await repo.getData()).receipts.at(-1)).toMatchObject({
        actualDeliveryDate: "2026-07-21",
        deliveryReference: "DR-1001",
        courierOrDriver: "Juan / LBC",
        lines: [
          expect.objectContaining({
            batchNumber: "BATCH-2026-07",
            deviceTestStatus: "passed",
          }),
        ],
      });
    });
  });
});
