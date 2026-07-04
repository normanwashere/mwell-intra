import type { IconName } from '@/components/Icon';
import type { Tone } from '@/components/ui';
import type { WarehouseData } from '@/data/repository';
import { toStockState } from '@/data/repository';
import { lowStockProducts } from '@/domain/stock';
import { can } from '@/auth/roles';
import type { Role } from '@/domain/types';

export interface AppNotification {
  id: string;
  tone: Tone;
  icon: IconName;
  title: string;
  detail: string;
  /** Route to open when the notification is tapped. Omitted when the current
   *  role can't reach any relevant screen (so a tap never dead-ends on a Guard). */
  to?: string;
}

/**
 * Derives actionable alerts from the current warehouse state: out-of-stock and
 * low-stock SKUs, plus reservations awaiting issuance. Targets are role-aware:
 * a link is only attached when the role can actually open the destination.
 */
export function buildNotifications(
  data: WarehouseData,
  role: Role,
): AppNotification[] {
  const state = toStockState(data);
  const notifications: AppNotification[] = [];

  // Every role has manage_inventory, so product detail is always reachable.
  const canOpenInventory = can(role, 'manage_inventory');
  const canOpenEvents = can(role, 'reserve_allocate') || can(role, 'view_finance');
  const canOpenAllocations = can(role, 'reserve_allocate') || can(role, 'issue_items');

  for (const { product, available } of lowStockProducts(state)) {
    notifications.push({
      id: `low-${product.id}`,
      tone: available === 0 ? 'rose' : 'amber',
      icon: 'alert',
      title: available === 0 ? `${product.name} out of stock` : `${product.name} low`,
      detail:
        available === 0
          ? `Reorder now (threshold ${product.reorderPoint})`
          : `${available} left · reorder at ${product.reorderPoint}`,
      to: canOpenInventory ? `/inventory/${product.id}` : undefined,
    });
  }

  const pending = data.allocations.filter((a) => a.status === 'reserved');
  for (const a of pending) {
    const product = data.products.find((p) => p.id === a.productId);
    const event = data.events.find((e) => e.id === a.eventId);
    const to =
      event && canOpenEvents
        ? `/events/${event.id}`
        : canOpenAllocations
          ? '/allocations'
          : undefined;
    notifications.push({
      id: `reserved-${a.id}`,
      tone: 'brand',
      icon: 'calendar',
      title: 'Reservation awaiting issue',
      detail: `${a.quantity}× ${product?.name ?? a.productId} · ${event?.name ?? a.eventId}`,
      to,
    });
  }

  return notifications;
}
