import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (page: string) => readFileSync(new URL(`./pages/${page}.tsx`, import.meta.url), 'utf8');

describe('Procurement workspace layout', () => {
  it.each(['RequestsPage', 'PurchaseOrdersPage'])('keeps %s filters next to a compact table', (page) => {
    const text = source(page);
    expect(text).toContain('<QueueFilters items={filterCards} value={filter} onChange={applyFilter} />');
    expect(text).toContain('density="compact"');
    expect(text).not.toContain('<StatCard');
  });

  it('uses unframed request form sections without changing the step and footer landmarks', () => {
    const text = source('CreateRequestPage');
    expect(text).not.toMatch(/<section className="card/);
    expect(text).toContain('aria-label="Request steps"');
    expect(text).toContain('onSubmit={(e) => handleSubmit(e, false)}');
    expect(text).toContain('md:sticky md:bottom-0');
  });
});
