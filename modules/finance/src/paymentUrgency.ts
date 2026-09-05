import type { FinancePaymentItem } from './types';

export function paymentUrgency(items: readonly FinancePaymentItem[]): FinancePaymentItem[] {
  const rank = (p: FinancePaymentItem) => p.status === 'ready_for_finance' ||
    (p.status === 'accepted' && p.remainingAmount > 0) ? 0 : p.status === 'returned' ? 1 : p.status === 'draft' ? 2 : 3;
  const due = (p: FinancePaymentItem) => p.dueDate && Number.isFinite(Date.parse(p.dueDate)) ? Date.parse(p.dueDate) : Infinity;
  return items.filter(p => p.status !== 'superseded').sort((a, b) =>
    rank(a) - rank(b) || (due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1) ||
    a.preparedAt.localeCompare(b.preparedAt) || a.id.localeCompare(b.id));
}

export function paymentAge(item: FinancePaymentItem, now = new Date()): string {
  const due = item.dueDate ? Date.parse(`${item.dueDate.slice(0, 10)}T23:59:59+08:00`) : NaN;
  const waiting = Math.max(0, Math.floor((now.getTime() - Date.parse(item.preparedAt)) / 86400000));
  return `${Number.isFinite(due) ? `${due < now.getTime() ? 'Overdue' : 'Due'} ${item.dueDate}` : 'Due date unavailable'}; ${Number.isFinite(waiting) ? `Waiting ${waiting} days` : 'Waiting age unavailable'}`;
}
