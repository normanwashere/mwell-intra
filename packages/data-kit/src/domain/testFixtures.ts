export type RecordPurpose = 'unclassified' | 'business-tester' | 'scenario-ready' | 'load-only' | 'historical-evidence';
export type RecordVisibility = 'operational' | 'all' | Exclude<RecordPurpose, 'unclassified'>;
export interface RecordClassification {
  purpose: RecordPurpose;
  scenarioName?: string;
  startingState?: string;
  nextActor?: string;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Explicit persisted fixture metadata, or the exact Sep12 seed contract. Titles alone are never evidence. */
export function classifyRecord(value: unknown): RecordClassification {
  const row = object(value);
  const fixture = object(row.fixture ?? object(row.compliance).fixture ?? object(row.attributes).fixture);
  const purpose = fixture.purpose;
  if (purpose === 'scenario-ready') {
    const scenarioName = text(fixture.scenarioName), startingState = text(fixture.startingState), nextActor = text(fixture.nextActor);
    if (scenarioName && startingState && nextActor) return { purpose, scenarioName, startingState, nextActor };
  }
  if (purpose === 'load-only' || purpose === 'historical-evidence' || purpose === 'business-tester') return { purpose };
  // scripts/qa/seed-performance-volume.sql creates exactly 1..100 with this persisted note.
  if (/^perf-sep12-request-(?:[1-9]|[1-9][0-9]|100)$/.test(text(row.id)) &&
      row.description === 'Synthetic list-volume fixture; not submitted or approved.') return { purpose: 'load-only' };
  const lines = Array.isArray(row.lines) ? row.lines.map(object) : [];
  const order = /^PERF-SEP12-ORDER-(\d{4})$/.exec(text(row.external_reference ?? row.externalReference));
  if (order && Number(order[1]) >= 1 && Number(order[1]) <= 200 &&
      (row.order_notes ?? row.orderNotes) === 'PERF-SEP12 synthetic volume fixture. No payment or stock allocated. Do not dispatch.' &&
      lines.length === 1 && lines[0]?.productId === `perf-sep12-product-${Number(order[1])}`) return { purpose: 'load-only' };
  const department = /^PERF-SEP12 draft stock request ([1-9]|[1-4][0-9]|50)$/.exec(text(row.purpose));
  if (department && lines.length === 1 && lines[0]?.productId === `perf-sep12-product-${department[1]}`) return { purpose: 'load-only' };
  return { purpose: 'unclassified' };
}

export const RECORD_VIEWS: readonly { value: RecordVisibility; label: string }[] = [
  { value: 'operational', label: 'Operational records' },
  { value: 'scenario-ready', label: 'Scenario-ready (declared)' },
  { value: 'business-tester', label: 'Business tester records' },
  { value: 'load-only', label: 'Load-only fixtures' },
  { value: 'historical-evidence', label: 'Historical evidence' },
  { value: 'all', label: 'All records' },
];
export function readRecordVisibility(value: string | null): RecordVisibility {
  return RECORD_VIEWS.find(option => option.value === value)?.value ?? 'operational';
}
export function recordIsVisible(record: RecordClassification, view: RecordVisibility): boolean {
  return view === 'all' || (view === 'operational'
    ? record.purpose !== 'load-only'
    : record.purpose === view);
}
export function recordPurposeLabel(record: RecordClassification): string | undefined {
  if (record.purpose === 'unclassified') return undefined;
  return RECORD_VIEWS.find(option => option.value === record.purpose)?.label;
}
