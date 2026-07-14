'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { FINANCE_DEMO_DATA } from './seed';
import type {
  FinanceActivity,
  FinanceActivityFilter,
  FinanceActivitySource,
  FinanceData,
  FinancePaymentItem,
  FinanceSummary,
  PaymentReadinessStatus,
} from './types';

type FinanceClient = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type UnknownRow = Record<string, unknown>;

export interface FinanceSourceAccess {
  procurement: boolean;
  warehouse: boolean;
}

const ACTIVITY_SOURCES = new Set<FinanceActivitySource>([
  'procurement_po',
  'warehouse_receipt',
  'warehouse_return',
]);

const PAYMENT_STATUSES = new Set<PaymentReadinessStatus>([
  'draft',
  'ready_for_finance',
  'returned',
  'accepted',
  'released',
  'superseded',
]);

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  const result = text(value);
  return result || undefined;
}

function amount(value: unknown): number {
  const result = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function rows(value: unknown): UnknownRow[] {
  return Array.isArray(value) ? (value as UnknownRow[]) : [];
}

export function summarizeFinanceData(data: FinanceData): FinanceSummary {
  const committedValue = data.activity
    .filter((item) => item.source === 'procurement_po')
    .reduce((sum, item) => sum + item.amount, 0);
  const receivedValue = data.activity
    .filter((item) => item.source === 'warehouse_receipt')
    .reduce((sum, item) => sum + item.amount, 0);
  const returnedValue = Math.abs(
    data.activity
      .filter((item) => item.source === 'warehouse_return')
      .reduce((sum, item) => sum + item.amount, 0),
  );
  return {
    inventoryValue: data.inventoryValue,
    committedValue,
    receivedValue,
    returnedValue,
    netWarehouseValue: receivedValue - returnedValue,
    reviewCount: data.payments.filter((item) => item.status === 'ready_for_finance').length,
    returnedCount: data.payments.filter((item) => item.status === 'returned').length,
    acceptedCount: data.payments.filter(
      (item) => item.status === 'accepted' || item.status === 'released',
    ).length,
  };
}

export function filterFinanceActivity(
  activity: readonly FinanceActivity[],
  filter: FinanceActivityFilter,
): FinanceActivity[] {
  if (filter === 'all') return [...activity];
  const source: FinanceActivitySource =
    filter === 'procurement'
      ? 'procurement_po'
      : filter === 'receipts'
        ? 'warehouse_receipt'
        : 'warehouse_return';
  return activity.filter((item) => item.source === source);
}

export function scopeFinanceData(
  data: FinanceData,
  access: FinanceSourceAccess,
): FinanceData {
  return {
    activity: data.activity.filter((item) =>
      item.source === 'procurement_po' ? access.procurement : access.warehouse,
    ),
    payments: access.procurement ? [...data.payments] : [],
    inventoryValue: access.warehouse ? data.inventoryValue : 0,
    warnings: [...data.warnings],
  };
}

function mapActivity(row: UnknownRow): FinanceActivity | null {
  const source = text(row.source) as FinanceActivitySource;
  const referenceId = text(row.ref_id);
  if (!ACTIVITY_SOURCES.has(source) || !referenceId) return null;
  return {
    id: `${source}:${referenceId}`,
    source,
    referenceId,
    purchaseOrderId: optionalText(row.po_id),
    vendorId: optionalText(row.vendor_id),
    amount: amount(row.amount),
    status: text(row.status, 'unknown'),
    occurredAt: text(row.occurred_at, new Date(0).toISOString()),
  };
}

function mapPayment(
  row: UnknownRow,
  purchaseOrders: ReadonlyMap<string, UnknownRow>,
): FinancePaymentItem | null {
  const id = text(row.id);
  const purchaseOrderId = text(row.purchase_order_id);
  const status = text(row.status) as PaymentReadinessStatus;
  if (!id || !purchaseOrderId || !PAYMENT_STATUSES.has(status)) return null;
  const po = purchaseOrders.get(purchaseOrderId);
  return {
    id,
    purchaseOrderId,
    poNumber: text(po?.po_number, purchaseOrderId),
    vendorName: text(po?.vendor_name, 'Vendor not available'),
    amount: amount(po?.total),
    poStatus: text(po?.status, 'unknown'),
    status,
    poMatch: row.po_match === true,
    invoiceReference: optionalText(row.invoice_or_si_storage_path),
    preparedAt: text(row.prepared_at, new Date(0).toISOString()),
    preparedBy: optionalText(row.prepared_by),
    reviewedAt: optionalText(row.finance_reviewed_at),
    reviewedBy: optionalText(row.finance_reviewed_by),
    reviewNote: optionalText(row.finance_note),
  };
}

export async function loadLiveFinanceData(
  client: FinanceClient,
  access: FinanceSourceAccess = { procurement: true, warehouse: true },
): Promise<FinanceData> {
  const emptyResult = () =>
    Promise.resolve({ data: [] as UnknownRow[], error: null as { message: string } | null });
  const [
    activityResult,
    purchaseOrderResult,
    paymentResult,
    inventoryResult,
    productResult,
  ] = await Promise.all([
    access.procurement || access.warehouse
      ? client
          .schema('core')
          .from('v_finance_activity')
          .select('source,ref_id,po_id,vendor_id,amount,status,occurred_at')
          .order('occurred_at', { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.procurement
      ? client
          .schema('procurement')
          .from('purchase_orders')
          .select('id,po_number,vendor_name,total,status,updated_at')
          .order('updated_at', { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.procurement
      ? client
          .schema('procurement')
          .from('payment_readiness_packs')
          .select(
            'id,purchase_order_id,status,po_match,invoice_or_si_storage_path,prepared_by,prepared_at,finance_reviewed_by,finance_reviewed_at,finance_note',
          )
          .neq('status', 'superseded')
          .order('prepared_at', { ascending: false })
          .limit(1000)
      : emptyResult(),
    access.warehouse
      ? client
          .schema('warehouse')
          .from('inventory_position_v1')
          .select('product_id,on_hand')
          .limit(100000)
      : emptyResult(),
    access.warehouse
      ? client
          .schema('warehouse')
          .from('products')
          .select('id,unit_cost')
          .limit(10000)
      : emptyResult(),
  ]);

  const warnings: string[] = [];
  if (activityResult.error) warnings.push(`Financial activity: ${activityResult.error.message}`);
  if (purchaseOrderResult.error)
    warnings.push(`Purchase orders: ${purchaseOrderResult.error.message}`);
  if (paymentResult.error)
    warnings.push(`Payment readiness: ${paymentResult.error.message}`);
  if (inventoryResult.error || productResult.error)
    warnings.push(
      `Inventory valuation: ${inventoryResult.error?.message ?? productResult.error?.message ?? 'source unavailable'}`,
    );

  const purchaseOrders = new Map(
    rows(purchaseOrderResult.data).map((row) => [text(row.id), row]),
  );
  const unitCostByProduct = new Map(
    rows(productResult.data).map((row) => [text(row.id), amount(row.unit_cost)]),
  );
  const inventoryValue = rows(inventoryResult.data).reduce(
    (sum, row) =>
      sum + amount(row.on_hand) * (unitCostByProduct.get(text(row.product_id)) ?? 0),
    0,
  );

  return scopeFinanceData({
    activity: rows(activityResult.data)
      .map(mapActivity)
      .filter((item): item is FinanceActivity => item !== null),
    payments: rows(paymentResult.data)
      .map((row) => mapPayment(row, purchaseOrders))
      .filter((item): item is FinancePaymentItem => item !== null),
    inventoryValue,
    warnings,
  }, access);
}

export function useFinanceData(): {
  data: FinanceData;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { mode, supabaseClient, userRoles } = useSession();
  const live = mode === 'supabase' ? supabaseClient : null;
  const procurementAccess = can(userRoles, 'procurement', 'view_finance');
  const warehouseAccess = can(userRoles, 'warehouse', 'view_finance');
  const [data, setData] = useState<FinanceData>(
    live
      ? { activity: [], payments: [], inventoryValue: 0, warnings: [] }
      : scopeFinanceData(FINANCE_DEMO_DATA, {
          procurement: procurementAccess,
          warehouse: warehouseAccess,
        }),
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) {
      setData(
        scopeFinanceData(FINANCE_DEMO_DATA, {
          procurement: procurementAccess,
          warehouse: warehouseAccess,
        }),
      );
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadLiveFinanceData(live, {
        procurement: procurementAccess,
        warehouse: warehouseAccess,
      });
      setData(next);
      setError(next.warnings.length > 0 ? next.warnings.join(' ') : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Finance data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [live, procurementAccess, warehouseAccess]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
