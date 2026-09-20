import type { ProcurementRequest } from './types';
import { classifyRecord, readRecordVisibility, recordIsVisible, type RecordClassification, type RecordVisibility } from '../../../packages/data-kit/src/domain/testFixtures';

export type RequestListRow = ProcurementRequest & { references?: string[]; classification?: RecordClassification };
export type RequestListFilter = 'all' | 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
export interface RequestListState {
  filter: RequestListFilter; search: string; owner: 'all' | 'mine'; from: string; to: string;
  sort: string; dir: 'asc' | 'desc'; shown: number; records: RecordVisibility;
}
const filters = new Set(['all', 'draft', 'submitted', 'approved', 'rejected', 'cancelled']);
const sorts = new Set(['title', 'estimatedAmount', 'neededBy', 'createdAt']);
const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value) ? value : '';

export function readRequestList(params: URLSearchParams): RequestListState {
  const shown = Number(params.get('shown'));
  return {
    filter: filters.has(params.get('filter') ?? '') ? params.get('filter') as RequestListFilter : 'all',
    search: (params.get('q') ?? '').slice(0, 120), owner: params.get('owner') === 'mine' ? 'mine' : 'all',
    from: date(params.get('from')), to: date(params.get('to')),
    sort: sorts.has(params.get('sort') ?? '') ? params.get('sort')! : 'createdAt',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    shown: Number.isSafeInteger(shown) && shown >= 50 ? shown : 50,
    records: params.has('records') || params.get('uat') === '1' ? readRecordVisibility(params.get('records')) : 'all',
  };
}

export function filterRequests<T extends RequestListRow>(rows: readonly T[], state: RequestListState, actorId: string): T[] {
  const words = state.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const status = state.filter === 'all' || row.status === state.filter || (state.filter === 'submitted' && row.status === 'under_review');
    const day = row.createdAt.slice(0, 10);
    const content = [row.id, row.title, row.vendorName, ...(row.references ?? [])].join(' ').toLowerCase();
    return status && (state.owner !== 'mine' || row.requesterId === actorId) &&
      (!state.from || day >= state.from) && (!state.to || day <= state.to) &&
      words.every(word => content.includes(word)) && recordIsVisible(row.classification ?? classifyRecord(row), state.records);
  });
}
export function sortRequests<T extends RequestListRow>(rows: readonly T[], state: RequestListState): T[] {
  return [...rows].sort((a, b) => {
    const key = state.sort as 'title' | 'estimatedAmount' | 'neededBy' | 'createdAt';
    const left = a[key] ?? '', right = b[key] ?? '';
    const compare = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return (state.dir === 'asc' ? compare : -compare) || a.id.localeCompare(b.id);
  });
}
const contextKeys = ['filter', 'q', 'owner', 'from', 'to', 'sort', 'dir', 'shown', 'records', 'uat'] as const;
const contextName = (key: string) => `from${key[0]!.toUpperCase()}${key.slice(1)}`;
export function requestDetailPath(id: string, params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of contextKeys) if (params.has(key)) query.set(contextName(key), params.get(key)!);
  return `/requests/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
}
export function requestReturnPath(search: string): string {
  const context = new URLSearchParams(search), candidate = new URLSearchParams();
  for (const key of contextKeys) if (context.has(contextName(key))) candidate.set(key, context.get(contextName(key))!);
  const state = readRequestList(candidate), query = new URLSearchParams();
  const safe = { filter: state.filter, q: state.search, owner: state.owner, from: state.from, to: state.to, sort: state.sort, dir: state.dir, shown: String(state.shown), records: state.records, uat: candidate.get('uat') === '1' ? '1' : '' };
  for (const key of contextKeys) if (candidate.has(key) && safe[key]) query.set(key, safe[key]);
  return `/procurement${query.size ? `?${query}` : ''}`;
}
