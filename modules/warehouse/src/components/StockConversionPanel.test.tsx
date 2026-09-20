import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockConversionPanel } from "./StockConversionPanel";
import { StockConversionRejectedError } from "@intra/data-kit";

const mocks = vi.hoisted(() => ({ load: vi.fn(), execute: vi.fn(), session: { mode: "supabase", profile: { id: "operator" }, userCapabilities: { warehouse: ["manage_returns"] } } }));
vi.mock("@intra/auth", () => ({ useSession: () => mocks.session }));
vi.mock("@/app/store", () => ({ useWarehouse: () => ({
  data: { products: [], events: [], storageAreas: [], kitDefinitions: [], units: [], returns: [] },
  loadStockConversionWorkspace: mocks.load, executeStockConversion: mocks.execute,
}) }));

describe("StockConversionPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.session.mode = "supabase";
    mocks.session.userCapabilities.warehouse = ["manage_returns"];
    mocks.load.mockReset().mockResolvedValue({ recipes: [], batches: [], candidates: [], recovery_available: false });
    mocks.execute.mockReset();
  });
  it("fails closed in demo without pretending stock conversion succeeded", () => {
    mocks.session.mode = "demo";
    render(<StockConversionPanel />);
    expect(screen.getByText(/requires the governed live service/i)).toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("shows missing recipe status without offering implicit conversion", async () => {
    render(<StockConversionPanel />);
    expect(await screen.findByText("No approved conversion recipes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve recipe" })).not.toBeInTheDocument();
  });
  it("does not enable work after a failed read and offers an explicit retry", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Conversion service not installed"));
    render(<StockConversionPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Conversion service not installed");
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversion work" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No approved conversion recipes.")).toBeInTheDocument();
  });
  it("restores the exact uncertain command after remount and preserves its retry identity", async () => {
    const command = { action: "complete", batch_id: "batch-1", idempotency_key: "conversion-complete-123", evidence_urls: ["https://evidence.test/check"] };
    sessionStorage.setItem("warehouse-stock-conversion:operator", JSON.stringify(command));
    mocks.execute.mockResolvedValue(false);
    const first = render(<StockConversionPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved submission" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith(command));
    first.unmount();
    render(<StockConversionPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved submission" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.execute.mock.calls[1]![0]).toEqual(mocks.execute.mock.calls[0]![0]);
  });
  it("clears a proven rolled-back command so the selection can be corrected", async () => {
    const command = { action: "complete", batch_id: "batch-1", idempotency_key: "conversion-complete-123", evidence_urls: ["https://evidence.test/check"] };
    sessionStorage.setItem("warehouse-stock-conversion:operator", JSON.stringify(command));
    mocks.execute.mockRejectedValue(new StockConversionRejectedError("Source is held"));
    render(<StockConversionPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved submission" }));
    await waitFor(() => expect(sessionStorage.getItem("warehouse-stock-conversion:operator")).toBeNull());
    expect(screen.queryByRole("button", { name: "Retry saved submission" })).not.toBeInTheDocument();
  });
});
