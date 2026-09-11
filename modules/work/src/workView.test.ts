import { describe, expect, it } from 'vitest';
import { readWorkView, searchWork, writeWorkView } from './workView';

describe('My Work view links', () => {
  it('restores supported views and sources without widening source access', () => {
    expect(readWorkView('?view=waiting&source=finance&q=PO', ['procurement'])).toEqual({ view: 'waiting', source: 'all', search: 'PO' });
    expect(readWorkView('?view=completed&source=procurement', ['procurement']).source).toBe('procurement');
    expect(readWorkView('?view=unknown', []).view).toBe('action');
  });
  it('preserves a follow-up anchor and unrelated context', () => {
    expect(writeWorkView(new URL('https://example.test/work?from=home#followup-123'), { view: 'waiting', source: 'warehouse', search: 'test' })).toBe('/work?from=home&view=waiting&source=warehouse&q=test#followup-123');
  });
  it('clears default filters and encodes query text', () => {
    expect(writeWorkView(new URL('https://example.test/work?view=waiting&source=warehouse&q=old'), { view: 'action', source: 'all', search: '' })).toBe('/work');
    expect(readWorkView('?q=' + 'x'.repeat(150), []).search).toHaveLength(120);
  });
  it('searches visible record and owner labels without changing order or source records', () => {
    const rows = [{ title: 'PR-1 Rings', status: 'submitted', source: 'procurement', owner: 'Department approver' }, { title: 'PR-2', status: 'closed', source: 'procurement' }];
    expect(searchWork(rows, 'rings approver')).toEqual([rows[0]]);
    expect(searchWork(rows, '')).toEqual(rows);
    expect(rows).toHaveLength(2);
  });
});
