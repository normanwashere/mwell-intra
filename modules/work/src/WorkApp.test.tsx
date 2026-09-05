import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkApp } from './WorkApp';

vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { kind: 'employee' }, loading: false }) }));
vi.mock('./FollowupQueue', () => ({ FollowupQueue: () => null }));
vi.mock('./data', async importOriginal => ({
  ...await importOriginal<typeof import('./data')>(),
  useWorkData: () => ({ loading: false, error: null, refresh: vi.fn(), data: { items: [
    { id: 'event-A', source: 'events', title: 'Confirm event A fulfillment', description: 'Review event A', status: 'planned', priority: 'normal', href: '/events/event-A' },
    { id: 'event-B', source: 'events', title: 'Confirm event B fulfillment', description: 'Review event B', status: 'planned', priority: 'normal', href: '/events/event-B' },
  ] } }),
}));

describe('My Work source links', () => {
  it('renders distinct task-specific accessible names with unchanged visible labels and source targets', () => {
    const html = renderToStaticMarkup(createElement(WorkApp));
    const links = html.match(/<a\b[^>]*aria-label="Open source:[\s\S]*?<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const id of ['A', 'B']) {
      const link = links.find(value => value.includes(`aria-label="Open source: Confirm event ${id} fulfillment"`));
      expect(link).toBeDefined();
      expect(link).toContain(`href="/events/event-${id}"`);
      expect(link).toContain('class="btn-primary shrink-0"');
      expect(link).toMatch(/>Open source\s*<svg/);
    }
  });
});
