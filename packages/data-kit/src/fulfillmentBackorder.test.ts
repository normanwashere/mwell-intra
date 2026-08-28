import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./inMemoryRepository";
import { buildSeed } from "./seed";

async function setup() {
  const repo = new InMemoryRepository(buildSeed(), { storage: null });
  const order = await repo.createFulfillmentOrder({
    source: "event",
    eventId: "evt-makati",
    externalReference: "BACKORDER-ZERO",
    sourceLocationId: "loc-wh",
    lines: [
      { productId: "doctor-token", quantity: 4 },
      { productId: "shirt-l", quantity: 2 },
    ],
    actor: "requester@mwell.com.ph",
  });
  return { repo, order };
}

describe("fulfillment backorder split", () => {
  it("retains only positive lines and conserves demand without reserving or moving stock", async () => {
    const { repo, order } = await setup();
    const before = await repo.getData();
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "split_backorder",
      actor: "operator@mwell.com.ph",
      fulfilledLines: [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: 0 },
      ],
    });
    const after = await repo.getData();
    expect(after.fulfillmentOrders[0]?.lines).toEqual([
      expect.objectContaining({ productId: "doctor-token", quantity: 3 }),
    ]);
    expect(after.fulfillmentOrders[1]).toMatchObject({
      parentOrderId: order.id,
      status: "received",
      externalReference: "BACKORDER-ZERO-BO-1",
    });
    expect(after.fulfillmentOrders[1]?.lines).toEqual([
      expect.objectContaining({ productId: "doctor-token", quantity: 1 }),
      expect.objectContaining({ productId: "shirt-l", quantity: 2 }),
    ]);
    expect(after.stockLevels).toEqual(before.stockLevels);
    expect(after.units).toEqual(before.units);
    expect(after.fulfillmentReservations).toEqual(
      before.fulfillmentReservations,
    );
    await repo.advanceFulfillmentOrder({
      orderId: order.id,
      action: "allocate",
      actor: "operator@mwell.com.ph",
    });
    expect((await repo.getData()).fulfillmentReservations).toEqual([
      expect.objectContaining({ productId: "doctor-token", quantity: 3 }),
    ]);
  });

  it.each([
    [
      "all zero",
      [
        { productId: "doctor-token", quantity: 0 },
        { productId: "shirt-l", quantity: 0 },
      ],
    ],
    [
      "no deferred",
      [
        { productId: "doctor-token", quantity: 4 },
        { productId: "shirt-l", quantity: 2 },
      ],
    ],
    ["missing line", [{ productId: "doctor-token", quantity: 3 }]],
    [
      "negative",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: -1 },
      ],
    ],
    [
      "over demand",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: 3 },
      ],
    ],
    [
      "fractional",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: 1.5 },
      ],
    ],
    [
      "non finite",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: NaN },
      ],
    ],
    [
      "duplicate",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: 1 },
        { productId: "shirt-l", quantity: 1 },
      ],
    ],
    [
      "unknown",
      [
        { productId: "doctor-token", quantity: 3 },
        { productId: "shirt-l", quantity: 1 },
        { productId: "unknown", quantity: 1 },
      ],
    ],
  ] as const)(
    "rejects %s without partial mutation",
    async (_label, fulfilledLines) => {
      const { repo, order } = await setup();
      const before = await repo.getData();
      await expect(
        repo.advanceFulfillmentOrder({
          orderId: order.id,
          action: "split_backorder",
          actor: "operator@mwell.com.ph",
          fulfilledLines: [...fulfilledLines],
        }),
      ).rejects.toThrow();
      expect(await repo.getData()).toEqual(before);
    },
  );
});
