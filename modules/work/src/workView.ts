import type { WorkSource } from './types';
import { readRecordVisibility, type RecordVisibility } from '../../../packages/data-kit/src/domain/testFixtures';

export type WorkView = 'action' | 'waiting' | 'completed';
export interface WorkViewState { view: WorkView; source: 'all' | WorkSource; search: string; records?: RecordVisibility }
export const INITIAL_WORK_VIEW: WorkViewState = { view: 'action', source: 'all', search: '' };

export function readWorkView(search: string, sources: readonly WorkSource[]): WorkViewState {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const source = params.get('source') as WorkSource;
  return {
    view: view === 'waiting' || view === 'completed' ? view : 'action',
    source: sources.includes(source) ? source : 'all',
    search: (params.get('q') ?? '').slice(0, 120),
    ...(params.has('records') || params.get('uat') === '1' ? { records: readRecordVisibility(params.get('records')) } : {}),
  };
}

export function writeWorkView(url: URL, state: WorkViewState): string {
  for (const [key, value] of [['view', state.view === 'action' ? '' : state.view], ['source', state.source === 'all' ? '' : state.source], ['q', state.search.trim()], ['records', state.records ?? '']]) {
    if (value) url.searchParams.set(key!, value); else url.searchParams.delete(key!);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function searchWork<T extends { id?: string; title: string; status: string; source: string; description?: string; owner?: string; nextStep?: string }>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const content = [item.id, item.title, item.status, item.source, item.description, item.owner, item.nextStep].filter(Boolean).join(' ').toLowerCase();
    return words.every(word => content.includes(word));
  });
}
