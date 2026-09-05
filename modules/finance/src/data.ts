'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession, useCan } from '@intra/auth';
import { FINANCE_DEMO_DATA } from './seed';
import type { SearchCloseSources, LoadCloseEvidence, CloseSource, CloseEvidenceOption } from './sourceSelection';
import { closeSourceBlocker } from './sourceSelection';
import type {
  FinanceActivity,
  FinanceActivityFilter,
  FinanceActivitySource,
  FinanceData,
  FinanceCloseEntry,
  ManageFinanceCloseEntryInput,
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
    committedValue: data.totals?.committedValue ?? committedValue,
    receivedValue: data.totals?.receivedValue ?? receivedValue,
    returnedValue: data.totals?.returnedValue ?? returnedValue,
    netWarehouseValue: (data.totals?.receivedValue ?? receivedValue) - (data.totals?.returnedValue ?? returnedValue),
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

export function validateFinanceCloseEntry(input: ManageFinanceCloseEntryInput): string[] {
  const errors: string[] = [];
  if (input.action === 'save' && (!Number.isFinite(input.amount) || Number(input.amount) <= 0)) {
    errors.push('Amount must be greater than zero.');
  }
  if (input.action === 'save' && (!input.sourceRecordType || !input.sourceRecordId?.trim())) {
    errors.push('Select a canonical source record.');
  }
  if (input.action === 'save' && (!input.evidenceRecordType || !input.evidenceRecordId?.trim())) {
    errors.push('Select registered evidence.');
  }
  if (input.action === 'save' && input.evidenceUrl?.trim() && !isSupportedFinanceEvidenceReference(input.evidenceUrl)) {
    errors.push('Use a valid HTTPS evidence URL or governed evidence reference.');
  }
  if (input.action === 'exception' && !input.reconciliationNote?.trim()) {
    errors.push('Provide a correction reason before flagging a close entry.');
  }
  return errors;
}

export type FinanceSource = keyof NonNullable<FinanceData['sourceStates']>;
const FINANCE_SOURCES: FinanceSource[] = ['activity', 'payments', 'inventory', 'close'];
const EMPTY_FINANCE_DATA: FinanceData = { activity: [], payments: [], closeEntries: [], inventoryValue: 0, warnings: [] };
function warningSource(warning: string): FinanceSource {
  if (warning.startsWith('Purchase orders:') || warning.startsWith('Payment readiness:')) return 'payments';
  if (warning.startsWith('Inventory valuation:')) return 'inventory';
  if (warning.startsWith('Finance close:')) return 'close';
  return 'activity';
}

export function mergeFinanceSource(current: FinanceData, next: FinanceData, source: FinanceSource): FinanceData {
  return {
    ...current,
    ...(source === 'activity' ? { activity: next.activity, totals: next.totals }
      : source === 'payments' ? { payments: next.payments }
        : source === 'inventory' ? { inventoryValue: next.inventoryValue } : { closeEntries: next.closeEntries }),
    sourceStates: { ...current.sourceStates!, [source]: next.sourceStates![source] },
    warnings: [...current.warnings.filter((warning) => warningSource(warning) !== source), ...next.warnings],
  };
}

export function isSupportedFinanceEvidenceReference(value?: string): boolean {
  const reference = value?.trim();
  if (!reference) return false;
  if (/^evidence:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reference)) return true;
  if (/^memory:\/\/[A-Za-z0-9._/-]+$/.test(reference)) return true;
  try {
    const url = new URL(reference);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
      && !/\/storage\/v1\/object\/(sign|public)\//i.test(decodeURIComponent(url.pathname))
      && ![...url.searchParams.keys()].some((key) => /^(token|signature|sig|expires|x-amz-.+|x-goog-.+)$/i.test(key));
  } catch {
    return false;
  }
}

export function applyMemoryFinanceCloseEntry(
  data: FinanceData,
  input: ManageFinanceCloseEntryInput,
  actor = 'finance@mwell.demo',
): FinanceData {
  const errors = validateFinanceCloseEntry(input);
  if (errors.length) throw new Error(errors[0]);
  const now = new Date().toISOString();
  if (input.action === 'save') {
    const existing = input.id ? data.closeEntries.find(item => item.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Finance close entry not found');
    if (existing && (!input.expectedUpdatedAt || existing.updatedAt !== input.expectedUpdatedAt)) throw new Error('Finance close entry changed; refresh and try again');
    if (existing && (['posted','reconciled'].includes(existing.status) || existing.sourceRecordType === 'event_reconciliation')) throw new Error('This entry cannot be manually rewritten');
    if (
      input.sourceRecordType === 'event_reconciliation' &&
      data.closeEntries.some(
        (item) =>
          item.sourceRecordType === 'event_reconciliation' &&
          item.sourceRecordId === input.sourceRecordId,
      )
    ) {
      throw new Error('The Finance close entry is generated by Event settlement approval and cannot be prepared manually.');
    }
    const entry: FinanceCloseEntry = {
      id: input.id ?? `close-demo-${Date.now()}`,
      periodStart: input.periodStart ?? '',
      periodEnd: input.periodEnd ?? '',
      entryType: input.entryType ?? 'cost_center',
      sourceModule: input.sourceModule ?? 'finance',
      sourceReference: input.sourceReference ?? 'memory',
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      evidenceRecordType: input.evidenceRecordType,
      evidenceRecordId: input.evidenceRecordId,
      costCenter: input.costCenter,
      amount: Number(input.amount),
      status: 'ready',
      evidenceUrl: input.evidenceUrl,
      reconciliationNote: input.reconciliationNote,
      preparedBy: actor,
      preparedActor: { id: actor, email: actor },
      preparedAt: now,
      updatedAt: now,
    };
    return { ...data, closeEntries: [{...existing,...entry}, ...data.closeEntries.filter(item => item.id !== entry.id)] };
  }
  const entry = data.closeEntries.find((item) => item.id === input.id);
  if (!entry) throw new Error('Finance close entry was not found. Refresh before retrying.');
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== entry.updatedAt) throw new Error('Finance close entry changed; refresh and try again');
  if (input.action === 'post' && entry.status !== 'ready') {
    throw new Error('Only a ready entry can be posted.');
  }
  if (input.action === 'post' && entry.preparedBy === actor) {
    throw new Error('A different Finance user must post a prepared close entry.');
  }
  if (
    input.action === 'post' &&
    entry.sourceRecordType === 'event_reconciliation' &&
    entry.settlementApprovedBy === actor
  ) {
    throw new Error('The Event settlement approver cannot post its generated close entry.');
  }
  if (
    input.action === 'post' &&
    entry.sourceRecordType === 'event_reconciliation' &&
    !isSupportedFinanceEvidenceReference(entry.evidenceUrl)
  ) {
    throw new Error('Use a valid Event reconciliation evidence reference before posting.');
  }
  if (input.action === 'reconcile' && entry.status !== 'posted') {
    throw new Error('Post the entry before reconciliation.');
  }
  if (input.action === 'reconcile' && entry.postedBy === actor) {
    throw new Error('A different Finance user must reconcile a posted close entry.');
  }
  if (input.action === 'reconcile' && entry.preparedBy === actor) {
    throw new Error('The preparer cannot reconcile their own entry.');
  }
  if (
    input.action === 'reconcile' &&
    entry.sourceRecordType === 'event_reconciliation' &&
    entry.settlementApprovedBy === actor
  ) {
    throw new Error('The Event settlement approver cannot reconcile its generated close entry.');
  }
  if (input.action === 'exception' && !['draft', 'ready'].includes(entry.status)) {
    throw new Error('Only a draft or ready entry can be flagged.');
  }
  const status =
    input.action === 'post' ? 'posted' : input.action === 'reconcile' ? 'reconciled' : 'exception';
  return {
    ...data,
    closeEntries: data.closeEntries.map((item) =>
      item.id === entry.id
        ? {
            ...item,
            status,
            reconciliationNote: input.reconciliationNote ?? item.reconciliationNote,
            correctionBy: input.action === 'exception' ? actor : item.correctionBy,
            correctionAt: input.action === 'exception' ? now : item.correctionAt,
            postedBy: input.action === 'post' ? actor : item.postedBy,
            postedAt: input.action === 'post' ? now : item.postedAt,
            reconciledBy: input.action === 'reconcile' ? actor : item.reconciledBy,
            reconciledAt: input.action === 'reconcile' ? now : item.reconciledAt,
            updatedAt: now,
          }
        : item,
    ),
  };
}

export function scopeFinanceData(data: FinanceData, access: FinanceSourceAccess): FinanceData {
  return {
    ...data,
    activity: data.activity.filter((item) =>
      item.source === 'procurement_po' ? access.procurement : access.warehouse,
    ),
    payments: access.procurement ? [...data.payments] : [],
    closeEntries: [...data.closeEntries],
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
    amount: amount(row.invoice_amount ?? po?.total),
    invoiceNumber: optionalText(row.invoice_number),
    dueDate: optionalText(row.due_date),
    releasedAmount: amount(row.released_amount),
    remainingAmount: Math.max(
      amount(row.invoice_amount ?? po?.total) - amount(row.released_amount),
      0,
    ),
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

function mapCloseEntry(row: UnknownRow): FinanceCloseEntry | null {
  const id = text(row.id);
  const entryType = text(row.entry_type) as FinanceCloseEntry['entryType'];
  if (!id || !entryType) return null;
  return {
    id,
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    entryType,
    sourceModule: text(row.source_module),
    sourceReference: text(row.source_reference),
    sourceRecordType: optionalText(row.source_record_type) as FinanceCloseEntry['sourceRecordType'],
    sourceRecordId: optionalText(row.source_record_id),
    evidenceRecordType: optionalText(
      row.evidence_record_type,
    ) as FinanceCloseEntry['evidenceRecordType'],
    evidenceRecordId: optionalText(row.evidence_record_id),
    costCenter: optionalText(row.cost_center),
    amount: amount(row.amount),
    status: text(row.status, 'draft') as FinanceCloseEntry['status'],
    evidenceUrl: optionalText(row.evidence_url),
    reconciliationNote: optionalText(row.reconciliation_note),
    preparedBy: text(row.prepared_by),
    preparedAt: text(row.prepared_at),
    postedBy: optionalText(row.posted_by),
    postedAt: optionalText(row.posted_at),
    reconciledBy: optionalText(row.reconciled_by),
    reconciledAt: optionalText(row.reconciled_at),
    settlementApprovedBy: optionalText(row.settlement_approved_by),
    correctionBy: optionalText(row.correction_by),
    correctionAt: optionalText(row.correction_at),
    preparedActor: optionalText(row.prepared_by)
      ? {
          id: text(row.prepared_by),
          name: optionalText(row.prepared_by_name),
          email: optionalText(row.prepared_by_email),
        }
      : undefined,
    postedActor: optionalText(row.posted_by)
      ? {
          id: text(row.posted_by),
          name: optionalText(row.posted_by_name),
          email: optionalText(row.posted_by_email),
        }
      : undefined,
    reconciledActor: optionalText(row.reconciled_by)
      ? {
          id: text(row.reconciled_by),
          name: optionalText(row.reconciled_by_name),
          email: optionalText(row.reconciled_by_email),
        }
      : undefined,
    updatedAt: text(row.updated_at),
  };
}

export async function manageLiveFinanceCloseEntry(
  client: FinanceClient,
  input: ManageFinanceCloseEntryInput,
): Promise<FinanceCloseEntry> {
  const validation = validateFinanceCloseEntry(input);
  if (validation.length) throw new Error(validation[0]);
  const { data, error } = await client.schema('core').rpc('manage_finance_close_entry', {
    payload: {
      action: input.action,
      id: input.id ?? null,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      entry_type: input.entryType ?? null,
      source_module: input.sourceModule ?? null,
      source_reference: input.sourceReference ?? null,
      source_record_type: input.sourceRecordType ?? null,
      source_record_id: input.sourceRecordId ?? null,
      evidence_record_type: input.evidenceRecordType ?? null,
      evidence_record_id: input.evidenceRecordId ?? null,
      cost_center: input.costCenter ?? null,
      amount: input.amount ?? null,
      evidence_url: input.evidenceUrl ?? null,
      reconciliation_note: input.reconciliationNote ?? null,
      expected_updated_at: input.expectedUpdatedAt ?? null,
    },
  });
  if (error) throw error;
  const mapped = mapCloseEntry((data ?? {}) as UnknownRow);
  if (!mapped) throw new Error('Finance close entry could not be read.');
  return mapped;
}

export async function openLiveFinanceCloseEvidence(
  client: FinanceClient,
  entry: FinanceCloseEntry,
): Promise<string> {
  if (entry.id && !entry.evidenceUrl?.startsWith('evidence://') && entry.sourceRecordType !== 'event_reconciliation') {
    const response = await fetch('/api/finance/evidence',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryId:entry.id})});
    const result = await response.json();
    if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Evidence access restricted or unavailable.');
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid protected evidence URL');
    return result.url;
  }
  if (entry.evidenceUrl?.startsWith('evidence://')) {
    const response = await fetch('/api/evidence', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', reference: entry.evidenceUrl }) });
    const result = await response.json();
    if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Evidence access denied.');
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid evidence preview.');
    return result.url;
  }
  if (
    entry.sourceRecordType !== 'event_reconciliation' ||
    !entry.sourceRecordId
  ) {
    throw new Error('This close entry is not bound to Event reconciliation evidence.');
  }
  const { data, error } = await client
    .schema('warehouse')
    .rpc('open_event_reconciliation_evidence', {
      payload: { event_id: entry.sourceRecordId },
    });
  if (error) throw error;
  const evidenceUrl = text((data as UnknownRow | null)?.evidence_url);
  if (!isSupportedFinanceEvidenceReference(evidenceUrl)) {
    throw new Error('Event reconciliation evidence could not be retrieved.');
  }
  return evidenceUrl;
}
export async function loadFinancePages(client: FinanceClient, source: string): Promise<{ data: UnknownRow[]; error: { message: string } | null }> {
  const result: UnknownRow[] = [];
  let after = '';
  let total: number | undefined;
  try {
    for (;;) {
      const response = await client.schema('core').rpc('platform_finance_page', { p_source: source, p_after: after, p_size: 200 });
      if (response.error) throw response.error;
      const page = response.data as { rows: UnknownRow[]; next: string | null; total: number };
      if (!Array.isArray(page?.rows) || !Number.isFinite(page.total)) throw new Error('Incomplete Finance page');
      if (total !== undefined && total !== page.total) throw new Error('Finance population changed during paging. Retry to load a complete population.');
      total = page.total;
      result.push(...page.rows);
      if (!page.rows.length || !page.next) {
        if (result.length !== total) throw new Error('Incomplete Finance population. Retry this source.');
        break;
      }
      if (page.next <= after) throw new Error('Finance paging did not advance');
      after = page.next;
    }
    return { data: result, error: null };
  } catch (cause) { return { data: [], error: { message: cause instanceof Error ? cause.message : String((cause as {message?: string})?.message ?? 'Finance source unavailable') } }; }
}

export async function loadLiveFinanceData(
  client: FinanceClient,
  access: FinanceSourceAccess = { procurement: true, warehouse: true },
  source?: FinanceSource,
): Promise<FinanceData> {
  const includes = (candidate: FinanceSource) => !source || source === candidate;
  const emptyResult = () =>
    Promise.resolve({
      data: [] as UnknownRow[],
      error: null as { message: string } | null,
    });
  const [
    activityResult,
    purchaseOrderResult,
    paymentResult,
    inventoryResult,
    productResult,
    closeEntryResult,
  ] = await Promise.all([
    includes('activity') && (access.procurement || access.warehouse)
      ? loadFinancePages(client, 'activity')
      : emptyResult(),
    includes('payments') && access.procurement
      ? loadFinancePages(client, 'orders')
      : emptyResult(),
    includes('payments') && access.procurement
      ? loadFinancePages(client, 'payments')
      : emptyResult(),
    includes('inventory') && access.warehouse
      ? loadFinancePages(client, 'inventory')
      : emptyResult(),
    includes('inventory') && access.warehouse
      ? loadFinancePages(client, 'products')
      : emptyResult(),
    includes('close') && (access.procurement || access.warehouse)
      ? loadFinancePages(client, 'close')
      : emptyResult(),
  ]);

  const warnings: string[] = [];
  const end = new Date().toISOString().slice(0,10);
  const totalsResult = includes('activity') && (access.procurement || access.warehouse)
    ? await client.schema('core').rpc('platform_finance_totals', { p_start: end.slice(0,8) + '01', p_end: end })
    : { data: undefined, error: null };
  if (totalsResult.error) warnings.push(`Period totals: ${totalsResult.error.message}`);
  if (activityResult.error) warnings.push(`Financial activity: ${activityResult.error.message}`);
  if (purchaseOrderResult.error)
    warnings.push(`Purchase orders: ${purchaseOrderResult.error.message}`);
  if (paymentResult.error) warnings.push(`Payment readiness: ${paymentResult.error.message}`);
  if (closeEntryResult.error) warnings.push('Finance close: ' + closeEntryResult.error.message);
  if (inventoryResult.error || productResult.error)
    warnings.push(
      `Inventory valuation: ${inventoryResult.error?.message ?? productResult.error?.message ?? 'source unavailable'}`,
    );

  const purchaseOrders = new Map(rows(purchaseOrderResult.data).map((row) => [text(row.id), row]));
  const unitCostByProduct = new Map(
    rows(productResult.data).filter(row => row.unit_cost !== null && row.unit_cost !== undefined && Number.isFinite(Number(row.unit_cost))).map((row) => [text(row.id), amount(row.unit_cost)]),
  );
  const inventoryValue = rows(inventoryResult.data).reduce(
    (sum, row) => sum + amount(row.on_hand) * (unitCostByProduct.get(text(row.product_id)) ?? 0),
    0,
  );

  const missingCosts = rows(inventoryResult.data).some(row => !unitCostByProduct.has(text(row.product_id)) || row.on_hand == null || !Number.isFinite(Number(row.on_hand)));
  if (missingCosts) warnings.push('Inventory valuation: product cost unavailable');
  return scopeFinanceData(
    {
      totals: totalsResult.error ? undefined : totalsResult.data as FinanceData['totals'],
      sourceStates: {
        activity: !access.procurement && !access.warehouse ? 'not_authorized' : activityResult.error || totalsResult.error ? 'error' : 'complete',
        payments: !access.procurement ? 'not_authorized' : paymentResult.error || purchaseOrderResult.error ? 'error' : 'complete',
        inventory: !access.warehouse ? 'not_authorized' : inventoryResult.error || productResult.error || missingCosts ? 'error' : 'complete',
        close: !access.procurement && !access.warehouse ? 'not_authorized' : closeEntryResult.error ? 'error' : 'complete',
      },
      activity: rows(activityResult.data)
        .map(mapActivity)
        .filter((item): item is FinanceActivity => item !== null),
      payments: rows(paymentResult.data)
        .map((row) => mapPayment(row, purchaseOrders))
        .filter((item): item is FinancePaymentItem => item !== null),
      closeEntries: rows(closeEntryResult.data)
        .map(mapCloseEntry)
        .filter((item): item is FinanceCloseEntry => item !== null),
      inventoryValue,
      warnings,
    },
    access,
  );
}

export function useFinanceData(): {
  data: FinanceData;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  retrySource: (source: FinanceSource) => Promise<void>;
  retryingSources: Partial<Record<FinanceSource, boolean>>;
  manageCloseEntry: (input: ManageFinanceCloseEntryInput) => Promise<FinanceCloseEntry>;
  openCloseEvidence: (entry: FinanceCloseEntry) => Promise<string>;
  isDemo: boolean;
  searchSources?: SearchCloseSources;
  loadEvidenceOptions?: LoadCloseEvidence;
} {
  const { mode, supabaseClient, profile, userCapabilities, roleCapabilities } = useSession();
  const live = mode === 'supabase' ? supabaseClient : null;
  const procurementAccess = useCan('procurement', 'view_finance');
  const warehouseAccess = useCan('warehouse', 'view_finance');
  const capabilityIdentity = JSON.stringify([userCapabilities, roleCapabilities]);
  const scope = useMemo(() => ({ live, actor: profile?.id, procurementAccess, warehouseAccess, capabilityIdentity }),
    [live, profile?.id, procurementAccess, warehouseAccess, capabilityIdentity]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const dataScope = useRef(scope);
  const generations = useRef<Record<FinanceSource, number>>({ activity: 0, payments: 0, inventory: 0, close: 0 });
  const refreshGeneration = useRef(0);
  const searchSources = useCallback<SearchCloseSources>(async (query, type, id) => {
    if (!live) return [];
    if (type && closeSourceBlocker(type)) throw new Error(closeSourceBlocker(type));
    const result = await live.schema('core').rpc('platform_close_sources', { p_query: query, p_type: type ?? null, p_id: id ?? null });
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Source lookup unavailable');
    return result.data as CloseSource[];
  }, [live]);
  const loadEvidenceOptions = useCallback<LoadCloseEvidence>(async (type, id) => {
    if (!live) return [];
    const result = await live.schema('core').rpc('platform_close_evidence_options', { p_type: type, p_id: id });
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Evidence lookup unavailable');
    return result.data as CloseEvidenceOption[];
  }, [live]);
  const [data, setData] = useState<FinanceData>(
    live
      ? {
          activity: [],
          payments: [],
          closeEntries: [],
          inventoryValue: 0,
          warnings: [],
        }
      : scopeFinanceData(FINANCE_DEMO_DATA, {
          procurement: procurementAccess,
          warehouse: warehouseAccess,
        }),
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);
  const [retryingSources, setRetryingSources] = useState<Partial<Record<FinanceSource, boolean>>>({});
  const dataRef = useRef(data);
  dataRef.current = data;

  const refresh = useCallback(async () => {
    if (activeScope.current !== scope) return;
    const request = ++refreshGeneration.current;
    for (const source of FINANCE_SOURCES) generations.current[source]++;
    setRetryingSources({});
    if (!live) {
      const next = scopeFinanceData(FINANCE_DEMO_DATA, { procurement: procurementAccess, warehouse: warehouseAccess });
      dataScope.current = scope;
      dataRef.current = next;
      setData(next);
      setError(null);
      setLoading(false);
      return;
    }
    if (!scope.actor) {
      dataScope.current = scope;
      dataRef.current = EMPTY_FINANCE_DATA;
      setData(EMPTY_FINANCE_DATA);
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
      if (activeScope.current !== scope || refreshGeneration.current !== request) return;
      dataScope.current = scope;
      dataRef.current = next;
      setData(next);
      setError(next.warnings.length > 0 ? next.warnings.join(' ') : null);
    } catch (cause) {
      if (activeScope.current !== scope || refreshGeneration.current !== request) return;
      if (dataScope.current !== scope) {
        dataRef.current = EMPTY_FINANCE_DATA;
        setData(EMPTY_FINANCE_DATA);
      }
      dataScope.current = scope;
      setError(cause instanceof Error ? cause.message : 'Finance data could not be loaded.');
    } finally {
      if (activeScope.current === scope && refreshGeneration.current === request) setLoading(false);
    }
  }, [live, procurementAccess, warehouseAccess, scope]);

  const retrySource = useCallback(async (source: FinanceSource) => {
    if (!live || !scope.actor || activeScope.current !== scope || dataScope.current !== scope || loading) return;
    if (source === 'payments' ? !procurementAccess : source === 'inventory' ? !warehouseAccess : !procurementAccess && !warehouseAccess) return;
    const request = ++generations.current[source];
    setRetryingSources((current) => ({ ...current, [source]: true }));
    try {
      const next = await loadLiveFinanceData(live, { procurement: procurementAccess, warehouse: warehouseAccess }, source);
      if (activeScope.current !== scope || generations.current[source] !== request) return;
      const merged = mergeFinanceSource(dataRef.current, next, source);
      dataRef.current = merged;
      setData(merged);
      setError(merged.warnings.length ? merged.warnings.join(' ') : null);
    } catch (cause) {
      if (activeScope.current !== scope || generations.current[source] !== request) return;
      // A transport throw is an unavailable source, never a successful empty response.
      const prefix = { activity: 'Financial activity', payments: 'Payment readiness', inventory: 'Inventory valuation', close: 'Finance close' }[source];
      const current = dataRef.current;
      const failed = { ...current, sourceStates: { ...current.sourceStates!, [source]: 'error' as const },
        warnings: [`${prefix}: ${cause instanceof Error ? cause.message : 'Source unavailable'}`] };
      const merged = mergeFinanceSource(current, failed, source);
      dataRef.current = merged;
      setData(merged);
      setError(merged.warnings.join(' '));
    } finally {
      if (activeScope.current === scope && generations.current[source] === request) {
        setRetryingSources((current) => ({ ...current, [source]: false }));
      }
    }
  }, [live, scope, loading, procurementAccess, warehouseAccess]);

  const manageCloseEntry = useCallback(
    async (input: ManageFinanceCloseEntryInput) => {
      if (!live) {
        const next = applyMemoryFinanceCloseEntry(data, input, profile?.id ?? 'finance-demo');
        const result = next.closeEntries.find((entry) => entry.id === input.id) ?? next.closeEntries[0];
        if (!result) throw new Error('Finance close entry could not be recorded.');
        setData(next);
        return result;
      }
      const result = await manageLiveFinanceCloseEntry(live, input);
      await refresh();
      return result;
    },
    [live, refresh, profile?.id, data],
  );
  const openCloseEvidence = useCallback(
    async (entry: FinanceCloseEntry) => {
      if (live) return openLiveFinanceCloseEvidence(live, entry);
      if (!isSupportedFinanceEvidenceReference(entry.evidenceUrl)) {
        throw new Error('Event reconciliation evidence could not be retrieved.');
      }
      return entry.evidenceUrl!.trim();
    },
    [live],
  );
  useEffect(() => {
    void refresh();
    return () => {
      refreshGeneration.current++;
      for (const source of FINANCE_SOURCES) generations.current[source]++;
    };
  }, [refresh]);

  const sameScope = dataScope.current === scope;
  return { data: sameScope ? data : EMPTY_FINANCE_DATA, loading: loading || !sameScope,
    error: sameScope ? error : null, refresh, retrySource, retryingSources: sameScope ? retryingSources : {},
    manageCloseEntry, openCloseEvidence, isDemo: !live, searchSources: live ? searchSources : undefined, loadEvidenceOptions: live ? loadEvidenceOptions : undefined };
}
