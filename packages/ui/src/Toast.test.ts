import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_TOASTS,
  TOAST_DISMISS_CLASS,
  TOAST_MOTION_STATES,
  TOAST_STACK_CLASS,
  TOAST_TONE_STYLES,
  coalesceToastQueue,
  type ToastRecord,
} from './Toast';

const item = (id: number, message: string, tone: ToastRecord['tone'] = 'info'): ToastRecord => ({
  id,
  message,
  tone,
  count: 1,
});

describe('toast queue ergonomics', () => {
  it('uses contrast-safe status tones', () => {
    expect(TOAST_TONE_STYLES.success.cls).toContain('bg-emerald-700');
    expect(TOAST_TONE_STYLES.error.cls).toContain('bg-rose-700');
    expect(TOAST_TONE_STYLES.info.cls).toContain('bg-brand-700');
  });

  it('keeps the dismiss target at least 44px in both dimensions', () => {
    expect(TOAST_DISMISS_CLASS).toContain('pointer-events-auto');
    expect(TOAST_DISMISS_CLASS).toContain('h-12');
    expect(TOAST_DISMISS_CLASS).toContain('w-12');
  });

  it('does not translate stacked dismiss targets through neighboring toasts', () => {
    expect(TOAST_MOTION_STATES.initial).not.toHaveProperty('y');
    expect(TOAST_MOTION_STATES.animate).not.toHaveProperty('y');
    expect(TOAST_MOTION_STATES.exit).not.toHaveProperty('y');
  });

  it('keeps desktop notifications away from central form actions', () => {
    expect(TOAST_STACK_CLASS).toContain('sm:items-end');
    expect(TOAST_STACK_CLASS).toContain('sm:px-6');
  });

  it('coalesces an identical message and tone instead of stacking duplicates', () => {
    expect(coalesceToastQueue([item(1, 'Saved')], item(2, 'Saved'))).toEqual([
      { ...item(1, 'Saved'), count: 2 },
    ]);
  });

  it('does not merge the same message across different tones', () => {
    expect(
      coalesceToastQueue([item(1, 'Updated', 'success')], item(2, 'Updated', 'error')),
    ).toHaveLength(2);
  });

  it('caps the queue and retains the newest notifications', () => {
    const queue = [item(1, 'One'), item(2, 'Two'), item(3, 'Three')];
    expect(coalesceToastQueue(queue, item(4, 'Four'))).toEqual([
      item(2, 'Two'),
      item(3, 'Three'),
      item(4, 'Four'),
    ]);
    expect(MAX_VISIBLE_TOASTS).toBe(3);
  });
});
