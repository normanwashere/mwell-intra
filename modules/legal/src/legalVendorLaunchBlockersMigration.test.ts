import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = () =>
  readFileSync(
    resolve(
      process.cwd(),
      '../..',
      'supabase/migrations/20260815154324_legal_vendor_launch_blockers.sql',
    ),
    'utf8',
  );

describe('Legal/vendor launch blocker migration', () => {
  it('creates the invite and authoritative tailored checklist atomically', () => {
    const migration = sql();
    const invite = migration.slice(
      migration.indexOf('create or replace function legal.invite_vendor'),
    );
    expect(invite).toContain("core.has_live_cap('legal', 'manage_checklist')");
    expect(invite).toContain('private.legal_tailored_requirement_set');
    expect(invite).toContain('insert into legal.requirement_checklist_items');
    expect(invite).toContain('No authoritative checklist requirements resolved');
    expect(invite.indexOf('insert into legal.accreditation_cases')).toBeLessThan(
      invite.indexOf('insert into legal.requirement_checklist_items'),
    );
  });

  it('rejects empty checklists at submission and decision time', () => {
    const migration = sql();
    expect(migration).toContain('Authoritative checklist is empty; accreditation submission is blocked');
    expect(migration).toContain('Authoritative checklist is empty; accreditation decision is blocked');
  });

  it('enforces inviter, reviewer, decider, and DOA maker-checker separation', () => {
    const migration = sql();
    expect(migration).toContain('invited_by_user_id');
    expect(migration).toContain('reviewer_id');
    expect(migration).toContain('The inviter cannot review accreditation evidence');
    expect(migration).toContain('The inviter cannot decide the accreditation case');
    expect(migration).toContain('The evidence reviewer cannot decide the accreditation case');
    expect(migration).toContain('A separate DOA checker must activate the matrix');
  });

  it('owns accreditation expiry defaults and lifecycle evidence on the server', () => {
    const migration = sql();
    expect(migration).toContain("current_date + 60");
    expect(migration).toContain("current_date + 365");
    expect(migration).toContain("review_type in ('renewal','reinstatement')");
    expect(migration).toContain('A future accreditation expiry is required');
    expect(migration).toContain('A decision rationale is required');
  });

  it('converges private Legal document access without browser service authority', () => {
    const migration = sql();
    expect(migration).toContain("values ('documents', 'documents', false)");
    expect(migration).toContain('create policy documents_legal_vendor_insert');
    expect(migration).toContain('create or replace function legal.prepare_document_signed_access');
    expect(migration).toContain("'expires_in', 300");
    expect(migration).toContain('revoke all on function legal.prepare_document_signed_access');
  });
});
