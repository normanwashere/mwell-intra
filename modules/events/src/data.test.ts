import { describe, expect, it } from 'vitest';
import { lifecycleForDates, validateEventDraft } from './data';

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
