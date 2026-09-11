import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const source = readFileSync(new URL('../app/admin/users/page.tsx', import.meta.url), 'utf8');
it('reserves a visible action column and bounds desktop cells without changing the shared table', () => {
  expect(source).toContain('data-testid="admin-users-table"');
  expect(source).toContain('[&_table]:min-w-0');
  expect(source).toContain('[&_table]:table-fixed');
  expect(source).toContain('[&_th:last-child]:w-28');
  expect(source).toContain('[overflow-wrap:anywhere]');
  expect(source).not.toContain('min-w-[10rem]');
  expect(source).not.toContain('HeroStat');
  expect(source).not.toContain('StatCard');
});
