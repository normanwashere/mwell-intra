import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/domain/types";
import { PriceEditorSheet } from "./PriceEditorSheet";

const product: Product = {
  id: "prod-1",
  sku: "KIT-001",
  name: "Remote care kit",
  category: "device",
  deviceType: "smart_watch",
  serialized: true,
  attributes: {},
  unitCost: 750,
  price: 1000,
  reorderPoint: 5,
};

describe("PriceEditorSheet", () => {
  it("routes price changes to Product governance without a direct save control", () => {
    render(
      <PriceEditorSheet
        product={product}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open governed pricing" }),
    ).toHaveAttribute("href", "/product/pricing?productId=prod-1");
    expect(screen.getByText(/independent approval/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save price" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/sell price/i)).not.toBeInTheDocument();
  });
});
