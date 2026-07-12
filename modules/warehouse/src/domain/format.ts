// Warehouse display formatting — one vocabulary, one date convention, one
// sign convention (UX-REVIEW-FULL-APP.md Exec #4, WH-3/WH-4/WH-5).
//
// Rules enforced here:
//   • No raw enum slugs in UI copy (`cycle_count` → "Cycle count").
//   • Movement quantities are signed by direction: issues/allocations render
//     as outbound (−), receipts/returns as inbound (+). Adjustments and cycle
//     counts keep the sign of the recorded delta.
//   • Dates: en-PH "d MMM yyyy" everywhere; relative time only for recent
//     activity (< 7 days), falling back to the absolute date.

import type { MovementType, POStatus } from './types';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  receipt: 'Receipt',
  allocation: 'Allocation',
  issue: 'Issue',
  return: 'Return',
  vendor_return: 'Vendor return',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  cycle_count: 'Cycle count',
};

/** Human label for a movement type (never a raw slug). */
export function movementTypeLabel(type: MovementType): string {
  return MOVEMENT_TYPE_LABELS[type] ?? statusLabel(type);
}

/** Outbound movement types — stock leaving the warehouse. */
const OUTBOUND: ReadonlySet<MovementType> = new Set(['issue', 'allocation', 'vendor_return']);
/** Inbound movement types — stock coming back / arriving. */
const INBOUND: ReadonlySet<MovementType> = new Set(['receipt', 'return']);

/**
 * Direction-signed quantity for a movement. Issues are outbound and render
 * negative (an issue of 40 is "−40", never "+40"); receipts/returns positive;
 * adjustment/cycle-count deltas keep their recorded sign; transfers are
 * neutral (no sign — stock only changes place).
 */
export function signedQuantity(type: MovementType, quantity: number): string {
  const abs = Math.abs(quantity);
  if (OUTBOUND.has(type)) return `\u2212${abs}`;
  if (INBOUND.has(type)) return `+${abs}`;
  if (type === 'transfer') return `${abs}`;
  // adjustment / cycle_count: the stored quantity is a delta and keeps its sign.
  if (quantity < 0) return `\u2212${abs}`;
  if (quantity > 0) return `+${abs}`;
  return '0';
}

/** Generic slug → sentence-case label ("partially_received" → "Partially received"). */
export function statusLabel(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim();
  if (!words) return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const PO_STATUS_LABELS: Record<POStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

const MONTH_FMT = new Intl.DateTimeFormat('en-PH', { month: 'short' });

/**
 * en-PH medium date, always "d MMM yyyy" (e.g. "10 Jun 2026") regardless of
 * the runtime's ICU pattern for the locale. Empty string for invalid input.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_FMT.format(d)} ${d.getFullYear()}`;
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Activity timestamps: relative when recent (< 7 days), otherwise the
 * absolute en-PH date — so "24d ago" never has to be mentally decoded.
 */
export function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (Math.abs(diff) >= WEEK_MS) return formatDate(iso);
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Actor display names. Movements store the actor as an email; the demo seeds
 * use well-known addresses we can resolve to the persona's name. Unknown
 * actors fall back to the raw identifier (never truncated).
 */
const DEMO_ACTOR_NAMES: Record<string, string> = {
  'logistics@mwell.demo': 'Bea Santos',
  'ops@mwell.demo': 'Marco Reyes',
  'finance@mwell.demo': 'Rina Domingo',
  'bi@mwell.demo': 'Jules Aquino',
  'marketing@mwell.demo': 'Kai Mendoza',
  'pricing@mwell.demo': 'Pia Salcedo',
  'admin@mwell.demo': 'Patricia Lim',
};

export function actorName(actor: string): string {
  const known = DEMO_ACTOR_NAMES[actor.toLowerCase()];
  if (known) return known;
  // Seed actors like "logistics@mwell" / "mktg@mwell" → keep readable local part.
  return actor;
}

/**
 * Stable human PO numbers ("PO-0001") derived from creation order, replacing
 * raw ids like `po-wearables-1` doubling as user copy (WH-26). Deterministic
 * for a given dataset: sorted by createdAt, then id.
 */
export function poNumberMap(
  pos: readonly { id: string; createdAt: string }[],
): Map<string, string> {
  const sorted = [...pos].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const map = new Map<string, string>();
  sorted.forEach((po, i) => {
    map.set(po.id, `PO-${String(i + 1).padStart(4, '0')}`);
  });
  return map;
}
