import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastWithWhite(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((value) => channel(Number.parseInt(value, 16)));
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Invalid color: ${hex}`);
  }
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05);
}

describe('shared interaction styles', () => {
  it('keeps native mobile form controls at a 44px touch target', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("input:not([type='checkbox']):not([type='radio']):not([type='hidden'])");
    expect(styles).toContain('min-height: 2.75rem');
  });

  it('keeps primary actions above WCAG AA contrast with white text', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const primaryToken = styles.match(
      /\.btn-primary\s*\{[^}]*background:\s*var\((--brand-\d+)\)/s,
    )?.[1];

    expect(primaryToken).toBe('--brand-700');
    const tokenPattern = new RegExp(`${primaryToken}:\\s*(#[0-9a-f]{6})`, 'i');
    const primaryColor = styles.match(tokenPattern)?.[1];
    expect(primaryColor).toBeDefined();
    expect(contrastWithWhite(primaryColor!)).toBeGreaterThanOrEqual(4.5);
  });
});
