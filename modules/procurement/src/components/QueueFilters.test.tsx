// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { QueueFilters } from './QueueFilters';

it('keeps named count buttons and dispatches the existing filter keys', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onChange = vi.fn();
  const items = [
    { key: 'all', label: 'Total requests', value: 12345, icon: 'clipboard' as const, tone: 'brand' as const, hint: 'All statuses' },
    { key: 'submitted', label: 'In review', value: 4, icon: 'rotate' as const, tone: 'cyan' as const, hint: 'On the approval ladder' },
  ];
  try {
    await act(async () => root.render(<QueueFilters items={items} value="all" onChange={onChange} />));
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    const [all, submitted] = buttons;
    if (!all || !submitted) throw new Error('Expected both queue filters');
    expect(all.getAttribute('aria-label')).toBe('Total requests: 12345. View details');
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(submitted.getAttribute('aria-pressed')).toBe('false');
    expect(submitted.type).toBe('button');
    await act(async () => submitted.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('submitted');
    await act(async () => root.render(<QueueFilters items={items} value="submitted" onChange={onChange} />));
    expect(submitted.getAttribute('aria-pressed')).toBe('true');
    expect(host.firstElementChild?.className).toContain('grid-cols-2');
    expect(host.firstElementChild?.className).toContain('lg:grid-cols-4');
    expect(all.className).toContain('min-h-11');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
