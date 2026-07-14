export type FinanceActivitySource =
  | 'procurement_po'
  | 'warehouse_receipt'
  | 'warehouse_return';

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
  | 'draft'
  | 'ready_for_finance'
  | 'returned'
  | 'accepted'
  | 'released'
  | 'superseded';

export interface FinancePaymentItem {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  amount: number;
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

export interface FinanceData {
  activity: FinanceActivity[];
  payments: FinancePaymentItem[];
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
