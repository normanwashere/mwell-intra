import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkApp } from './WorkApp';

vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { kind: 'employee' }, loading: false }) }));
const state = vi.hoisted(() => ({ error: null as string | null, empty: false }));
vi.mock('./FollowupQueue', () => ({ FollowupQueue: () => createElement('section', null, 'Leadership follow-ups') }));
vi.mock('./tracking', () => ({ useWorkTracking: () => ({ items: [], loading: false, errors: [], refresh: vi.fn(), coverage: 'Your purchase and stock requests.' }) }));
vi.mock('./data', async importOriginal => ({
  ...await importOriginal<typeof import('./data')>(),
  useWorkData: () => ({ loading: false, error: state.error, refresh: vi.fn(), data: { items: state.empty ? [] : [
    { id: 'event-A', source: 'events', title: 'Confirm event A fulfillment', description: 'Review event A', status: 'planned', priority: 'normal', href: '/events/event-A' },
    { id: 'event-B', source: 'events', title: 'Confirm event B fulfillment', description: 'Review event B', status: 'planned', priority: 'normal', href: '/events/event-B' },
  ] } }),
}));

describe('My Work source links', () => {
  beforeEach(() => { state.error = null; state.empty = false; });
  it('keeps page identity and assigned work ahead of secondary follow-ups', () => {
    const html = renderToStaticMarkup(createElement(WorkApp));
    expect(html.indexOf('My Work')).toBeLessThan(html.indexOf('Leadership follow-ups'));
    expect(html.indexOf('Confirm event A')).toBeLessThan(html.indexOf('Leadership follow-ups'));
  });
  it('does not claim completion or an empty queue when its read failed', () => {
    state.error = 'Request failed'; state.empty = true;
    const html = renderToStaticMarkup(createElement(WorkApp));
    expect(html).toContain('Queue unavailable.');
    expect(html).not.toContain('No work in this view');
    expect(html).not.toContain('caught up');
  });
  it('does not equate an empty assignment queue with completed cross-department work', () => {
    state.empty = true;
    const html = renderToStaticMarkup(createElement(WorkApp));
    expect(html).toContain('Other departments may still be working on your requests.');
    expect(html).not.toContain('caught up');
  });
  it('renders distinct record links with unchanged source targets and secondary navigation styling', () => {
    const html = renderToStaticMarkup(createElement(WorkApp));
    const links = html.match(/<a\b[^>]*aria-label="Open record:[\s\S]*?<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const id of ['A', 'B']) {
      const link = links.find(value => value.includes(`aria-label="Open record: Confirm event ${id} fulfillment"`));
      expect(link).toBeDefined();
      expect(link).toContain(`href="/events/event-${id}"`);
      expect(link).toContain('class="btn-outline shrink-0"');
      expect(link).toMatch(/>Open record\s*<svg/);
    }
  });
  it('separates actionable assignments from tracked handovers and offers search and source filters', () => {
    const html = renderToStaticMarkup(createElement(WorkApp));
    expect(html).toContain('Needs your action');
    expect(html).toContain('Waiting on someone else');
    expect(html).toContain('Recently completed');
    expect(html).toContain('Search work');
    expect(html).toContain('aria-pressed="true"');
  });
});
