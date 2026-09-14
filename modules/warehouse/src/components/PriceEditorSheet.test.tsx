import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/domain/types";
import { PriceEditorSheet } from "./PriceEditorSheet";

const state = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("../../../../packages/auth/src/SessionProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../packages/auth/src/SessionProvider")>(),
  useSession: () => state.session,
}));
beforeEach(() => {
  state.session = { mode: 'supabase', loading: false, profile: { id: 'reader' }, userRoles: { warehouse: ['pricing'] },
    userCapabilities: { product: ['view_readiness', 'view_pricing'] }, roleCapabilities: {} };
});

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

  it.each([
    { userCapabilities: { warehouse: ['view_pricing', 'set_pricing'] } },
    { userCapabilities: { product: ['view_readiness'] } },
    { userCapabilities: { product: ['view_pricing'] } },
    { userCapabilities: {}, roleCapabilities: { product: ['view_readiness', 'view_pricing', 'propose_pricing'] } },
    { loading: true }, { profile: null },
  ])('keeps read-only context without a dead-end Product link: %j', change => {
    Object.assign(state.session, change);
    render(<PriceEditorSheet product={product} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Pricing governance' })).toBeInTheDocument();
    expect(screen.getByText('Current price')).toBeInTheDocument();
    expect(screen.getByText('Current margin')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open governed pricing' })).not.toBeInTheDocument();
    expect(screen.getByText(/Product team/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|approve|propose/i })).not.toBeInTheDocument();
  });

  it('withdraws the handoff when effective Product access is revoked while the context is open', () => {
    const props = { product, open: true, onOpenChange: vi.fn() };
    const view = render(<PriceEditorSheet {...props} />);
    expect(screen.getByRole('link', { name: 'Open governed pricing' })).toBeInTheDocument();
    state.session.userCapabilities = { product: ['view_readiness'] };
    view.rerender(<PriceEditorSheet {...props} />);
    expect(screen.queryByRole('link', { name: 'Open governed pricing' })).not.toBeInTheDocument();
    expect(screen.getByText('Current price')).toBeInTheDocument();
  });

  it.each(['contributor', 'product_owner'])('preserves the existing Product %s handoff in memory mode', role => {
    state.session = { mode: 'memory', loading: false, profile: { id: 'demo' }, userRoles: { product: [role] } };
    render(<PriceEditorSheet product={product} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Open governed pricing' })).toHaveAttribute('href', '/product/pricing?productId=prod-1');
  });
});
