export type FinanceActivitySource =
  "procurement_po" | "warehouse_receipt" | "warehouse_return";

export type FinanceActivityFilter =
  "all" | "procurement" | "receipts" | "returns";

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
  | "draft"
  | "ready_for_finance"
  | "returned"
  | "accepted"
  | "released"
  | "superseded";

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
  | "inventory_valuation"
  | "cogs"
  | "merchandise_expense"
  | "cost_center"
  | "write_off"
  | "event_settlement";

export interface FinanceCloseEntry {
  id: string;
  periodStart: string;
  periodEnd: string;
  entryType: FinanceCloseEntryType;
  sourceModule: string;
  sourceReference: string;
  costCenter?: string;
  amount: number;
  status: "draft" | "ready" | "posted" | "reconciled" | "exception";
  evidenceUrl?: string;
  reconciliationNote?: string;
  preparedBy: string;
  preparedAt: string;
  postedBy?: string;
  postedAt?: string;
}

export interface ManageFinanceCloseEntryInput {
  action: "save" | "post" | "reconcile" | "exception";
  id?: string;
  periodStart?: string;
  periodEnd?: string;
  entryType?: FinanceCloseEntryType;
  sourceModule?: string;
  sourceReference?: string;
  costCenter?: string;
  amount?: number;
  evidenceUrl?: string;
  reconciliationNote?: string;
}
export interface FinanceData {
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
