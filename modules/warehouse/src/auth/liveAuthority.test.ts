import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('live Warehouse UI authority', () => {
  it('never derives page action authority from the display role', () => {
    const pages = readdirSync(resolve(process.cwd(), 'src/pages'))
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));

    for (const page of pages) {
      const contents = source(`src/pages/${page}`);
      expect(contents, page).not.toMatch(/\bcan\s*\(\s*role\b/);
      expect(contents, page).not.toMatch(
        /import\s*\{[^}]*\bcan\b[^}]*\}\s*from\s*['"]@\/auth\/roles['"]/s,
      );
      expect(contents, page).not.toMatch(/\bisWarehouse(?:Operator|Supervisor)Role\s*\(/);
    }
  });

  it('does not use the display role for shell navigation or notifications', () => {
    const shell = source('src/components/AppShell.tsx');
    const notifications = source('src/app/notifications.ts');

    expect(shell).not.toMatch(/modulesForRole\s*\(\s*role\s*\)/);
    expect(shell).not.toMatch(/primaryModulesForRole\s*\(\s*role\s*\)/);
    expect(shell).toContain('can');
    expect(notifications).not.toMatch(/\bcan\s*\(\s*role\b/);
    expect(notifications).not.toMatch(
      /import\s*\{[^}]*\bcan\b[^}]*\}\s*from\s*['"]@\/auth\/roles['"]/s,
    );
  });
});
