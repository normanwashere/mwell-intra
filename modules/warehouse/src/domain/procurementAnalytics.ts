import type { Movement } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Average issued quantity per day for a product over the trailing window.
 * Total issue quantity within the last `windowDays` divided by `windowDays`.
 */
export function consumptionRatePerDay(
  movements: Movement[],
  productId: string,
  windowDays: number,
  now: Date = new Date(),
): number {
  if (windowDays <= 0) return 0;
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const issued = movements
    .filter(
      (m) =>
        m.type === 'issue' &&
        m.productId === productId &&
        new Date(m.createdAt).getTime() >= cutoff,
    )
    .reduce((sum, m) => sum + m.quantity, 0);
  return issued / windowDays;
}

/** How many days the available stock lasts at the given daily rate. */
export function daysOfCover(available: number, ratePerDay: number): number {
  if (ratePerDay <= 0) return Infinity;
  return available / ratePerDay;
}

export interface StockoutProjection {
  daysOfCover: number;
  atRisk: boolean;
}

/**
 * Projects whether stock runs out before replenishment arrives. At risk when
 * there is real demand and cover is shorter than the supplier lead time.
 */
export function projectedStockout(args: {
  available: number;
  ratePerDay: number;
  leadTimeDays: number;
}): StockoutProjection {
  const cover = daysOfCover(args.available, args.ratePerDay);
  return {
    daysOfCover: cover,
    atRisk: args.ratePerDay > 0 && cover < args.leadTimeDays,
  };
}
