import { describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceivingPage } from "./ReceivingPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { availableForProduct } from "@/domain/stock";

describe("ReceivingPage", () => {
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

    await user.click(screen.getByRole("button", { name: /receive .*item/i }));

    await waitFor(async () => {
      const after = availableForProduct(
        await repo.getStockState(),
        "ecg-ring-10",
      );
      expect(after).toBe(before + 1);
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

    await user.click(screen.getByRole("button", { name: /receive .*item/i }));
    await waitFor(async () => {
      const after = availableForProduct(
        await repo.getStockState(),
        "doctor-token",
      );
      expect(after).toBe(before + 6);
    });
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
