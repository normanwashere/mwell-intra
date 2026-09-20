import type { IconName } from '@/components/Icon';
import type { Tone } from '@/components/ui';
import type { WarehouseData } from '@/data/repository';
import { toStockState } from '@/data/repository';
import { lowStockProducts } from '@/domain/stock';
import type { WarehouseRouteId } from '@/app/modules';

export interface AppNotification {
  id: string;
  tone: Tone;
  icon: IconName;
  title: string;
  detail: string;
  issueType: 'shortage' | 'reservation';
  owner: string;
  nextStep: string;
  actionable: boolean;
  /** Route to open when the notification is tapped. Omitted when the current
   *  role can't reach any relevant screen (so a tap never dead-ends on a Guard). */
  to?: string;
}

/**
 * Derives actionable alerts from the current warehouse state: out-of-stock and
 * low-stock SKUs, plus reservations awaiting issuance. Targets are capability-aware:
 * a link is only attached when the current access snapshot can open the destination.
 */
export function buildNotifications(
  data: WarehouseData,
  canOpenRoute: (routeId: WarehouseRouteId) => boolean,
  actions: { canRecommendReplenishment?: boolean; canIssueStock?: boolean } = {},
): AppNotification[] {
  const state = toStockState(data);
  const notifications: AppNotification[] = [];

  const canOpenInventory = canOpenRoute('product-detail');
  const canOpenEvents = canOpenRoute('event-detail');
  const canOpenAllocations = canOpenRoute('allocations');
  const canRecommend = actions.canRecommendReplenishment === true && canOpenRoute('procurement');

  for (const { product, available } of lowStockProducts(state)) {
    notifications.push({
      id: `low-${product.id}`,
      tone: available === 0 ? 'rose' : 'amber',
      icon: 'alert',
      title: available === 0 ? `${product.name} out of stock` : `${product.name} low`,
      detail: `${product.sku} · ${available} available · minimum ${product.reorderPoint}`,
      issueType: 'shortage',
      owner: canRecommend ? 'Warehouse planning' : 'Procurement',
      nextStep: canRecommend ? 'Request replenishment' : 'Procurement to review replenishment',
      actionable: canRecommend,
      to: canRecommend ? `/procurement?product=${encodeURIComponent(product.id)}`
        : canOpenInventory ? `/inventory/${encodeURIComponent(product.id)}` : undefined,
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
      issueType: 'reservation',
      owner: 'Warehouse operations',
      nextStep: actions.canIssueStock && canOpenAllocations ? 'Review reserved stock for issue' : 'Warehouse operations to issue reserved stock',
      actionable: actions.canIssueStock === true && canOpenAllocations,
      to,
    });
  }

  const priority = (tone: Tone) => tone === 'rose' ? 0 : tone === 'amber' ? 1 : 2;
  return notifications.sort((a, b) => priority(a.tone) - priority(b.tone) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export interface NotificationFilter {
  search?: string;
  scope?: 'all' | 'actionable' | 'informational';
  issueType?: 'all' | AppNotification['issueType'];
}

export function groupNotifications(notifications: readonly AppNotification[], filters: NotificationFilter = {}) {
  const search = filters.search?.trim().toLowerCase() ?? '';
  const groups = new Map<string, { id: string; issueType: AppNotification['issueType']; owner: string; items: AppNotification[] }>();
  for (const item of notifications) {
    if (filters.scope === 'actionable' && !item.actionable) continue;
    if (filters.scope === 'informational' && item.actionable) continue;
    if (filters.issueType && filters.issueType !== 'all' && item.issueType !== filters.issueType) continue;
    if (search && !`${item.title} ${item.detail} ${item.owner} ${item.nextStep}`.toLowerCase().includes(search)) continue;
    const id = `${item.issueType}:${item.owner}`;
    const group = groups.get(id) ?? { id, issueType: item.issueType, owner: item.owner, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()];
}
