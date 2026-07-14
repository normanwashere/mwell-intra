import { describe, expect, it } from 'vitest';
import {
  lifecycleForDates,
  loadMemoryEvents,
  saveMemoryEvents,
  validateEventDraft,
} from './data';
import { EVENTS_DEMO_DATA } from './seed';

describe('event lifecycle rules', () => {
  it('classifies planned, active, and completed dates', () => {
    expect(lifecycleForDates('2026-07-15', '2026-07-16', '2026-07-14')).toBe('planned');
    expect(lifecycleForDates('2026-07-14', '2026-07-15', '2026-07-14')).toBe('active');
    expect(lifecycleForDates('2026-07-10', '2026-07-11', '2026-07-14')).toBe('completed');
  });

  it('rejects incomplete or reversed event dates', () => {
    expect(validateEventDraft({ name: '', type: 'corporate', startDate: '' })).toBe('Event name is required.');
    expect(validateEventDraft({ name: 'Town hall', type: 'corporate', startDate: '' })).toBe('Start date is required.');
    expect(validateEventDraft({ name: 'Town hall', type: 'corporate', startDate: '2026-07-15', endDate: '2026-07-14' })).toBe('End date cannot be before the start date.');
  });
});

describe('event demo repository', () => {
  it('falls back to the governed seed when the stored value is missing or invalid', () => {
    expect(loadMemoryEvents({ getItem: () => null })).toEqual(EVENTS_DEMO_DATA);
    expect(loadMemoryEvents({ getItem: () => '{invalid' })).toEqual(EVENTS_DEMO_DATA);
  });

  it('round-trips created events across route remounts', () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    };
    const created = {
      ...EVENTS_DEMO_DATA,
      events: [
        {
          id: 'evt-demo-created',
          name: 'Created event',
          type: 'corporate',
          startDate: '2026-07-20',
          lifecycle: 'planned' as const,
          reservedUnits: 0,
          issuedUnits: 0,
          returnedUnits: 0,
        },
        ...EVENTS_DEMO_DATA.events,
      ],
    };

    saveMemoryEvents(storage, created);

    expect(loadMemoryEvents(storage).events[0]).toMatchObject({
      id: 'evt-demo-created',
      name: 'Created event',
    });
  });
});
