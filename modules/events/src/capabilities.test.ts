import { describe, expect, it } from 'vitest';
import { eventCapabilityAllowed, eventRequestHref } from './capabilities';

describe('UX17 effective event capability gates', () => {
  it.each([undefined, [], ['view_events']])('withholds assigned-but-locked or revoked actions: %j', (live) => {
    expect(eventCapabilityAllowed({ events: ['coordinator'] }, 'create_event', 'supabase', live)).toBe(false);
  });
  it('allows certified capabilities and retains static roles only in memory mode', () => {
    expect(eventCapabilityAllowed({ events: ['coordinator'] }, 'create_event', 'supabase', ['create_event'])).toBe(true);
    expect(eventCapabilityAllowed({ events: ['viewer'] }, 'create_event', 'memory')).toBe(false);
  });
  it('UX10 links an exact request and retains its event return context', () => {
    const url = new URL(eventRequestHref('request-42', 'event-1'), 'https://intra.test');
    expect(url.pathname).toBe('/warehouse/fulfillment');
    expect(Object.fromEntries(url.searchParams)).toEqual({ tab: 'requests', request: 'request-42', next: '/events/event-1' });
  });
});
