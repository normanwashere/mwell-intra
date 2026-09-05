import { expect, it } from 'vitest';
import { deadlineLabel } from './deadline';
it('labels future, today, past, invalid and Philippine midnight deadlines', () => {
  const now = new Date('2026-09-05T16:01:00Z');
  expect(deadlineLabel('2026-09-12', now)).toBe('Due in 6 days (2026-09-12)');
  expect(deadlineLabel('2026-09-06', now)).toBe('Due today (2026-09-06)');
  expect(deadlineLabel('2026-09-04', now)).toBe('Overdue by 2 days (2026-09-04)');
  expect(deadlineLabel('invalid', now)).toBe('Due date unavailable');
  expect(deadlineLabel('2026-09-05T16:00:00Z', now)).toBe('Due today (2026-09-06)');
});
