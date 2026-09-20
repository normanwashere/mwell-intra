import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StockConversionRecipes } from "./StockConversionRecipes";
import { ProductApp } from "./ProductApp";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn(), canApprove: true, mode: "supabase" }));
vi.mock("@intra/auth", () => ({
  useCan: (_module: string, cap: string) => cap === "view_readiness" || (cap === "decide_go_live" && mock.canApprove),
  useSession: () => ({ profile: { id: "product-owner" }, mode: mock.mode, loading: false,
    userCapabilities: { product: mock.canApprove ? ["view_readiness", "decide_go_live"] : ["view_readiness"], warehouse: [] },
    supabaseClient: { schema: mock.schema } }),
}));
vi.mock("./data", () => ({ useProductWorkspace: () => ({ loading: false, data: { readiness: [], pricing: [] } }) }));

const options = {
  kits: [{ id: "kit-1", name: "Event kit", version: 3, product_id: "variant", product_name: "Event watch",
    base_product_id: "base", base_product_name: "Base watch", recovery_ready: true,
    packaging: [{ product_id: "bag", name: "Event bag", quantity: 2 }] }],
  events: [{ id: "event-1", name: "Health fair", status: "planned" }], recipes: [],
};

beforeEach(() => {
  sessionStorage.clear();
  mock.canApprove = true; mock.mode = "supabase";
  mock.schema.mockReset().mockReturnValue({ rpc: mock.rpc });
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "stock_conversion_recipe_workspace" ? options : { id: "recipe-1" }, error: null }));
});

async function fillRecipe() {
  await screen.findByRole("option", { name: "Event kit v3" });
  fireEvent.change(screen.getByLabelText("Approved kit definition"), { target: { value: "kit-1" } });
  fireEvent.change(screen.getByLabelText("Event"), { target: { value: "event-1" } });
  fireEvent.change(screen.getByLabelText("Product approval reference"), { target: { value: "Product decision 123" } });
  fireEvent.change(screen.getByLabelText("Product approval evidence URL"), { target: { value: "https://evidence.test/decision" } });
}

it("ProductApp gives a Product-only approver a reachable recipe approval surface", async () => {
  render(<ProductApp />);
  expect(screen.getByRole("link", { name: "Stock conversion recipes" })).toHaveAttribute("href", "#stock-conversion-recipes");
  await fillRecipe();
  fireEvent.click(screen.getByRole("button", { name: "Approve recipe" }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("execute_stock_conversion", { payload: expect.objectContaining({
    action: "approve_recipe", kit_definition_id: "kit-1", source_product_id: "base", output_product_id: "variant",
    packaging: [{ product_id: "bag", quantity: 2, disposition: "consume" }],
  }) }));
  expect(await screen.findByRole("status")).toHaveTextContent("Recipe approved");
  expect(mock.schema).toHaveBeenCalledWith("warehouse");
});

it("does not expose approval or fetch options without Product authority", () => {
  mock.canApprove = false;
  render(<ProductApp />);
  expect(screen.queryByRole("link", { name: "Stock conversion recipes" })).not.toBeInTheDocument();
  expect(mock.rpc).not.toHaveBeenCalled();
});

it("requires an explicit packaging disposition for recovery", async () => {
  render(<StockConversionRecipes />);
  await fillRecipe();
  fireEvent.change(screen.getByLabelText("Recipe direction"), { target: { value: "recovery" } });
  expect(screen.getByRole("button", { name: "Approve recipe" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Event bag disposition"), { target: { value: "recover" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve recipe" }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("execute_stock_conversion", { payload: expect.objectContaining({
    direction: "recovery", source_product_id: "variant", output_product_id: "base",
    packaging: [{ product_id: "bag", quantity: 2, disposition: "recover" }],
  }) }));
});

it("retains the exact approval across an uncertain response and remount", async () => {
  mock.rpc.mockImplementation(async (name: string) => name === "stock_conversion_recipe_workspace"
    ? { data: options, error: null } : { data: null, error: { message: "Network response lost" } });
  const first = render(<StockConversionRecipes />);
  await fillRecipe();
  fireEvent.click(screen.getByRole("button", { name: "Approve recipe" }));
  await screen.findByText(/Network response lost/);
  const firstPayload = mock.rpc.mock.calls.find(([name]) => name === "execute_stock_conversion")![1];
  first.unmount();
  render(<StockConversionRecipes />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved approval" }));
  await waitFor(() => expect(mock.rpc.mock.calls.filter(([name]) => name === "execute_stock_conversion")).toHaveLength(2));
  expect(mock.rpc.mock.calls.filter(([name]) => name === "execute_stock_conversion")[1]![1]).toEqual(firstPayload);
});

it("allows correction after a definitive database rejection", async () => {
  mock.rpc.mockImplementation(async (name: string) => name === "stock_conversion_recipe_workspace"
    ? { data: options, error: null } : { data: null, error: { code: "P0001", message: "Readiness no longer active" } });
  render(<StockConversionRecipes />);
  await fillRecipe();
  fireEvent.click(screen.getByRole("button", { name: "Approve recipe" }));
  await screen.findByText(/Readiness no longer active/);
  expect(screen.queryByRole("button", { name: "Retry saved approval" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Product approval reference")).toHaveValue("Product decision 123");
  expect(sessionStorage.getItem("product-stock-conversion:product-owner")).toBeNull();
});

it("fails closed with a read retry when the governed migration is unavailable", async () => {
  mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Recipe service not installed" } });
  render(<StockConversionRecipes />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Recipe service not installed");
  expect(screen.getByRole("button", { name: "Approve recipe" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh recipe approvals" }));
  expect(await screen.findByRole("option", { name: "Event kit v3" })).toBeInTheDocument();
});

it("does not simulate a governed approval in demo", () => {
  mock.mode = "memory";
  render(<StockConversionRecipes />);
  expect(screen.getByText(/requires the governed live service/)).toBeInTheDocument();
  expect(mock.rpc).not.toHaveBeenCalled();
});
