import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

describe("Merchandise pick capture", () => {
  it("allocates ten units, verifies one product code and exact quantity, without serials", async () => {
    const seed = makeRepo();
    const data = await seed.getData();
    const product = data.products.find(row => row.id === "doctor-token")!;
    data.storageAreas = [{ id: "merch-bin", locationId: "loc-wh", code: "MERCH-A", active: true }];
    data.stockLevels = [{ productId: product.id, locationId: "loc-wh", binId: "merch-bin", quantity: 1000 }];
    const repo = makeRepo(data);
    await repo.createFulfillmentOrder({ source: "department_request", externalReference: "MERCH-TEN", requestingDepartment: "marketing", sourceLocationId: "loc-wh", lines: [{ productId: product.id, quantity: 10 }], actor: "requester" });
    const advance = vi.spyOn(repo, "advanceFulfillmentOrder");
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: "warehouse_operator" });
    await user.click(await screen.findByRole("button", { name: "Allocate stock" }));
    await user.click(await screen.findByRole("button", { name: "Start picking" }));
    await user.click(await screen.findByRole("button", { name: "Confirm scanned pick" }));
    const dialog = await screen.findByRole("dialog");
    const code = within(dialog).getByLabelText(`Product barcode for ${product.name}`);
    const quantity = within(dialog).getByLabelText(`Picked quantity for ${product.name}`);
    expect(code).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Scanned bin code for/), "MERCH-A{Enter}");
    advance.mockClear();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Scan the product barcode");
    await user.type(code, "WRONG-PRODUCT{Enter}");
    expect(quantity).toBeDisabled();
    const otherProduct = data.products.find(row => row.id === "shirt-l")!;
    await user.type(code, `${otherProduct.barcode || otherProduct.sku}{Enter}`);
    expect(quantity).toBeDisabled();
    await user.type(code, `${product.barcode || product.sku}{Enter}`);
    expect(quantity).toBeEnabled();
    await user.type(code, `${product.barcode || product.sku}{Enter}`);
    expect(quantity).toHaveValue(null);
    for (const value of ["0", "-1", "1.5", "9", "11", "9007199254740992"]) {
      fireEvent.change(quantity, { target: { value } });
      fireEvent.submit(dialog.querySelector("form")!);
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Confirm exactly 10 whole units");
      expect(advance).not.toHaveBeenCalled();
    }
    fireEvent.change(quantity, { target: { value: "10" } });
    await user.type(within(dialog).getByLabelText(/Scanned bin code for/), "WRONG-BIN{Enter}");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Scanned bin code for/), "MERCH-A{Enter}");
    expect(within(dialog).queryByLabelText(/Scanned serial numbers/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm pick" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ action: "confirm_pick", pickedLines: [expect.objectContaining({ productId: product.id, quantity: 10, serialNumbers: [], binId: "merch-bin" })] }));
    const result = await repo.getData();
    expect(result.fulfillmentOrders[0]!.status).toBe("packing");
    expect(result.stockLevels[0]!.quantity).toBe(1000);
    expect(result.fulfillmentReservations.filter(row => row.status === "active").reduce((sum, row) => sum + row.quantity, 0)).toBe(10);
  });
});
