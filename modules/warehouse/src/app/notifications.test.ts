import { describe, it, expect } from "vitest";
import { buildNotifications, groupNotifications } from "./notifications";
import type { WarehouseData } from "@/data/repository";
import type { WarehouseRouteId } from "@/app/modules";

function data(): WarehouseData {
  return {
    products: [
      {
        id: "ring",
        sku: "RING",
        name: "Ring",
        category: "device",
        deviceType: "ecg_ring",
        serialized: true,
        attributes: {},
        unitCost: 2500,
        reorderPoint: 3,
      },
      {
        id: "shirt",
        sku: "SHIRT",
        name: "Shirt",
        category: "merchandise",
        merchandiseType: "shirt",
        serialized: false,
        attributes: {},
        unitCost: 200,
        reorderPoint: 10,
      },
    ],
    locations: [{ id: "loc-wh", name: "WH", type: "warehouse" }],
    storageAreas: [],
    suppliers: [],
    lots: [],
    units: [
      {
        id: "u1",
        productId: "ring",
        serialNumber: "SN1",
        locationId: "loc-wh",
        status: "in_stock",
      },
    ],
    stockLevels: [{ productId: "shirt", locationId: "loc-wh", quantity: 100 }],
    movements: [],
    allocations: [
      {
        id: "a1",
        eventId: "e1",
        productId: "shirt",
        quantity: 5,
        status: "reserved",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [
      { id: "e1", name: "Expo", type: "corporate", startDate: "2026-01-01" },
    ],
    returns: [],
    cycleCounts: [],
    receipts: [],
    purchaseOrders: [],
    fulfillmentOrders: [],
    fulfillmentReservations: [],
    departmentRequestOptions: [],
    departmentStockRequests: [],
    customerReturnCases: [],
    kitDefinitions: [],
    reKitWorkOrders: [],
  };
}

describe("buildNotifications", () => {
  const allow =
    (...routes: WarehouseRouteId[]) =>
    (route: WarehouseRouteId) =>
      routes.includes(route);

  it("keeps informational shortages with their next owner without an implied reorder action", () => {
    const d = data();
    d.units = [];
    const note = buildNotifications(d, allow('product-detail')).find(note => note.id === 'low-ring')!;
    expect(note.detail).not.toMatch(/reorder now/i);
    expect(note).toMatchObject({ issueType: 'shortage', owner: 'Procurement', actionable: false,
      nextStep: 'Procurement to review replenishment', to: '/inventory/ring' });
  });

  it("separates current action authority from access to a summary", () => {
    const routes = allow('product-detail', 'procurement', 'allocations');
    const notes = buildNotifications(data(), routes, { canRecommendReplenishment: true, canIssueStock: false });
    expect(notes.find(note => note.id === 'low-ring')).toMatchObject({ actionable: true,
      owner: 'Warehouse planning', nextStep: 'Request replenishment', to: '/procurement?product=ring' });
    expect(notes.find(note => note.id === 'reserved-a1')).toMatchObject({ actionable: false, owner: 'Warehouse operations' });
    expect(buildNotifications(data(), allow('product-detail'), { canRecommendReplenishment: true })
      .find(note => note.id === 'low-ring')?.actionable).toBe(false);
  });

  it("groups and filters hundreds of issues with reconciled counts, without mutating stock", () => {
    const d = data();
    d.products = Array.from({ length: 346 }, (_, i) => ({ ...d.products[0]!, id: `sku-${i}`, sku: `SKU-${i}`, name: `Device ${i}` }));
    d.allocations = [];
    const before = structuredClone(d);
    const notes = buildNotifications(d, allow('product-detail'));
    const groups = groupNotifications(notes);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ issueType: 'shortage', owner: 'Procurement' });
    expect(groups.reduce((total, group) => total + group.items.length, 0)).toBe(346);
    expect(groupNotifications(notes, { search: 'SKU-345' })[0]?.items.map(note => note.id)).toEqual(['low-sku-345']);
    expect(groupNotifications(notes, { scope: 'actionable' })).toEqual([]);
    expect(groupNotifications(notes, { issueType: 'reservation' })).toEqual([]);
    expect(d).toEqual(before);
    expect(buildNotifications(d, allow('product-detail'))).toEqual(notes);
  });

  it("flags low-stock SKUs and pending reservations", () => {
    const notes = buildNotifications(
      data(),
      allow("product-detail", "event-detail", "allocations"),
    );
    expect(notes.some((n) => n.id === "low-ring")).toBe(true);
    expect(notes.some((n) => n.id === "reserved-a1")).toBe(true);
  });

  it("marks zero-stock as out of stock (rose tone)", () => {
    const d = data();
    d.units = []; // ring now 0 available
    const ring = buildNotifications(d, allow("product-detail")).find(
      (n) => n.id === "low-ring",
    )!;
    expect(ring.tone).toBe("rose");
    expect(ring.title).toMatch(/out of stock/i);
  });

  it("omits reservation link for roles that cannot open events or allocations", () => {
    const note = buildNotifications(data(), allow("product-detail")).find(
      (n) => n.id === "reserved-a1",
    )!;
    expect(note.to).toBeUndefined();
  });

  it("links reservations to the event for roles that can open events", () => {
    const note = buildNotifications(data(), allow("event-detail")).find(
      (n) => n.id === "reserved-a1",
    )!;
    expect(note.to).toBe("/events/e1");
  });

  it("uses the supplied live capability predicate for notification targets", () => {
    const notes = buildNotifications(data(), allow("allocations"));
    expect(notes.find((note) => note.id === "low-ring")?.to).toBeUndefined();
    expect(notes.find((note) => note.id === "reserved-a1")?.to).toBe(
      "/allocations",
    );
  });
});
