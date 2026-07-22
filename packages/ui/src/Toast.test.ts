import { describe, expect, it } from 'vitest';
import { TOAST_DISMISS_CLASS, TOAST_TONE_STYLES } from './Toast';

describe('Toast accessibility contracts', () => {
  it('uses contrast-safe status tones', () => {
    expect(TOAST_TONE_STYLES.success.cls).toContain('bg-emerald-700');
    expect(TOAST_TONE_STYLES.error.cls).toContain('bg-rose-700');
    expect(TOAST_TONE_STYLES.info.cls).toContain('bg-brand-700');
  });

  it('keeps the dismiss target at least 44px in both dimensions', () => {
    expect(TOAST_DISMISS_CLASS).toContain('min-h-11');
    expect(TOAST_DISMISS_CLASS).toContain('min-w-11');
  });
});
