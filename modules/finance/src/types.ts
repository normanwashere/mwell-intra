export type FinanceActivitySource = 'procurement_po' | 'warehouse_receipt' | 'warehouse_return';

export type FinanceActivityFilter = 'all' | 'procurement' | 'receipts' | 'returns';

export interface FinanceActivity {
  id: string;
  source: FinanceActivitySource;
  referenceId: string;
  purchaseOrderId?: string;
  vendorId?: string;
  amount: number;
  status: string;
  occurredAt: string;
}

export type PaymentReadinessStatus =
  'draft' | 'ready_for_finance' | 'returned' | 'accepted' | 'released' | 'superseded';

export interface FinancePaymentItem {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  amount: number;
  invoiceNumber?: string;
  dueDate?: string;
  releasedAmount: number;
  remainingAmount: number;
  poStatus: string;
  status: PaymentReadinessStatus;
  poMatch: boolean;
  invoiceReference?: string;
  preparedAt: string;
  preparedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export type FinanceCloseEntryType =
  | 'inventory_valuation'
  | 'cogs'
  | 'merchandise_expense'
  | 'cost_center'
  | 'write_off'
  | 'event_settlement';

export type FinanceCloseSourceRecordType =
  | 'procurement_request'
  | 'purchase_order'
  | 'payment_readiness_pack'
  | 'payment_release'
  | 'warehouse_receipt'
  | 'event_reconciliation';

export type FinanceCloseEvidenceRecordType =
  | 'request_attachment'
  | 'payment_readiness_pack'
  | 'payment_release'
  | 'core_document'
  | 'warehouse_receipt'
  | 'event_reconciliation';

export interface FinanceActorLineage {
  id: string;
  name?: string;
  email?: string;
}

export interface FinanceCloseEntry {
  id: string;
  periodStart: string;
  periodEnd: string;
  entryType: FinanceCloseEntryType;
  sourceModule: string;
  sourceReference: string;
  sourceRecordType?: FinanceCloseSourceRecordType;
  sourceRecordId?: string;
  evidenceRecordType?: FinanceCloseEvidenceRecordType;
  evidenceRecordId?: string;
  costCenter?: string;
  amount: number;
  status: 'draft' | 'ready' | 'posted' | 'reconciled' | 'exception';
  evidenceUrl?: string;
  reconciliationNote?: string;
  preparedBy: string;
  preparedAt: string;
  postedBy?: string;
  postedAt?: string;
  reconciledBy?: string;
  reconciledAt?: string;
  settlementApprovedBy?: string;
  correctionBy?: string;
  correctionAt?: string;
  preparedActor?: FinanceActorLineage;
  postedActor?: FinanceActorLineage;
  reconciledActor?: FinanceActorLineage;
  updatedAt: string;
}

export interface ManageFinanceCloseEntryInput {
  action: 'save' | 'post' | 'reconcile' | 'exception';
  id?: string;
  periodStart?: string;
  periodEnd?: string;
  entryType?: FinanceCloseEntryType;
  sourceModule?: string;
  sourceReference?: string;
  sourceRecordType?: FinanceCloseSourceRecordType;
  sourceRecordId?: string;
  evidenceRecordType?: FinanceCloseEvidenceRecordType;
  evidenceRecordId?: string;
  costCenter?: string;
  amount?: number;
  evidenceUrl?: string;
  reconciliationNote?: string;
  expectedUpdatedAt?: string;
}
export interface FinanceData {
  sourceStates?: Record<'activity' | 'payments' | 'inventory' | 'close', 'not_authorized' | 'loading' | 'error' | 'complete'>;
  totals?: { committedValue: number; receivedValue: number; returnedValue: number; periodStart: string; periodEnd: string };
  activity: FinanceActivity[];
  payments: FinancePaymentItem[];
  closeEntries: FinanceCloseEntry[];
  inventoryValue: number;
  warnings: string[];
}

export interface FinanceSummary {
  inventoryValue: number;
  committedValue: number;
  receivedValue: number;
  returnedValue: number;
  netWarehouseValue: number;
  reviewCount: number;
  returnedCount: number;
  acceptedCount: number;
}
