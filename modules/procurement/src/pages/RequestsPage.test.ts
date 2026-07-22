import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RequestsPage heading contract', () => {
  it('uses a task-specific H1 instead of a user name', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/RequestsPage.tsx'), 'utf8');

    expect(source).toContain('title="Purchase requests"');
    expect(source).toContain('eyebrow="Procurement workspace"');
    expect(source).not.toContain('title={firstName}');
  });
});
