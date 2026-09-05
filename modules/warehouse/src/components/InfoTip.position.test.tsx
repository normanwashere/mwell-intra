import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InfoTip } from '@intra/ui';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('viewport-safe help', () => {
  it.each([0, 340])('keeps a long bubble within the viewport at trigger x=%s', x => {
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tooltip'
        ? { x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 312, width: 312, height: 200, toJSON() {} }
        : { x, y: 100, top: 100, left: x, bottom: 144, right: x + 44, width: 44, height: 44, toJSON() {} };
    });
    render(<InfoTip label="Full request record" content="Long request evidence and ownership explanation" />);
    fireEvent.focus(screen.getByRole('button', { name: 'Full request record' }));
    const tooltip = screen.getByRole('tooltip');
    expect(parseFloat(tooltip.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(tooltip.style.left) + 312).toBeLessThanOrEqual(382);
    expect(parseFloat(tooltip.style.top)).toBeGreaterThanOrEqual(8);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
