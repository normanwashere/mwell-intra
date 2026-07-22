import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shared interaction styles', () => {
  it('keeps native mobile form controls at a 44px touch target', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("input:not([type='checkbox']):not([type='radio']):not([type='hidden'])");
    expect(styles).toContain('min-height: 2.75rem');
  });
});
