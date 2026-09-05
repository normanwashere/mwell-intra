import type { FinanceCloseSourceRecordType, FinanceCloseEvidenceRecordType } from './types';
export interface CloseSource {
  type: FinanceCloseSourceRecordType; id: string; module: string; reference: string;
  party: string | null; amount: number | null; occurred_at: string; href: string;
}
export interface CloseEvidenceOption { id: string; label: string; type: FinanceCloseEvidenceRecordType }
export type SearchCloseSources = (query: string, type?: string, id?: string) => Promise<CloseSource[]>;
export type LoadCloseEvidence = (type: string, id: string) => Promise<CloseEvidenceOption[]>;

export function closeSourceBlocker(type: string): string | undefined {
  if (['purchase_order','warehouse_receipt','payment_release'].includes(type)) return;
  if (type === 'event_reconciliation') return 'Event settlements are system-generated. Use the governed Event record for correction; manual preparation is unavailable.';
  if (type === 'procurement_request' || type === 'payment_readiness_pack') return 'Direct request/pack preparation is unavailable in this picker. Select its governed purchase order or posted payment release instead.';
  return 'This record kind is not a supported canonical Finance close source. Select a purchase order, receipt, or posted payment release.';
}
