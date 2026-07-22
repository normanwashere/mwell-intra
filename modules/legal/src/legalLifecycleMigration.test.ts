import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () =>
  readFileSync(
    resolve(process.cwd(), '../..', 'supabase/migrations/20260722120000_legal_vendor_lifecycle_hardening.sql'),
    'utf8',
  );

const authorityMigration = () =>
  readFileSync(
    resolve(process.cwd(), '../..', 'supabase/migrations/20260722180000_vendor_lifecycle_authority_remediation.sql'),
    'utf8',
  );

describe('Legal and vendor lifecycle hardening migration', () => {
  it('adds versioned vendor-owned draft save and discard commands', () => {
    const sql = migration();
    expect(sql).toContain('save_vendor_application_draft');
    expect(sql).toContain('discard_vendor_application_draft');
    expect(sql).toContain('core.current_vendor_id()');
    expect(sql).toContain('expected_version');
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('private.policy_submit_vendor_application');
    expect(sql).toContain('v_version + 1');
  });

  it('records invite expiry, acceptance, supersession, and replay rejection', () => {
    const sql = migration();
    for (const field of [
      'expires_at',
      'accepted_at',
      'link_generation',
      'last_link_issued_at',
      'superseded_at',
      'replay_rejected_at',
    ])
      expect(sql).toContain(field);
    expect(sql).toContain('reconcile_vendor_invite_lifecycle');
    expect(sql).toContain('accept_current_vendor_invite');
    expect(sql).toContain("coalesce(delivered_at, created_at) + interval '24 hours'");
  });

  it('makes acceptance the only authority that activates vendor access', () => {
    const sql = authorityMigration();
    expect(sql).toContain('legal.vendor_invite_policy');
    expect(sql).toContain('prepare_vendor_invite_delivery');
    expect(sql).toContain('expected_generation');
    expect(sql).toContain('acceptance_token_hash');
    expect(sql).toContain("extensions.digest(convert_to(payload->>'acceptance_token', 'UTF8'), 'sha256')");
    expect(sql).toContain("v_invite.status <> 'sent'");
    expect(sql).toContain("status = 'accepted'");
    expect(sql).toContain("values (v_invite.auth_user_id, 'core', 'vendor_portal')");
    expect(sql).toContain("kind = 'vendor'");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('rejection_code');
  });

  it('keeps pending, expired, superseded, and replayed identities outside vendor RLS', () => {
    const sql = authorityMigration();
    expect(sql).toContain("invite.status = 'accepted'");
    expect(sql).toContain('invite.auth_user_id = auth.uid()');
    expect(sql).toContain("status in ('expired', 'superseded')");
    expect(sql).toContain('delete from core.user_roles');
    expect(sql).toContain("role = 'vendor_portal'");
    expect(sql).toContain('replay_rejected_at = now()');
    expect(sql).toContain('extensions.gen_random_bytes(32)');
  });

  it('rejects active identities before creation and serializes duplicate invite commands', () => {
    const sql = authorityMigration();
    const inviteFunction = sql.slice(sql.indexOf('create or replace function legal.invite_vendor'));
    expect(sql).toContain('legal.vendor_invite_commands');
    expect(sql).toContain('unique (actor_id, idempotency_key)');
    expect(sql).toContain('request_hash');
    expect(sql).toContain('on conflict (actor_id, idempotency_key) do nothing');
    expect(sql).toContain('Idempotency key reused with different content');
    expect(inviteFunction.indexOf('from core.profiles')).toBeLessThan(
      inviteFunction.indexOf('insert into core.vendors'),
    );
  });

  it('requires a different Legal actor to confirm high-risk decisions', () => {
    const sql = migration();
    expect(sql).toContain('accreditation_decision_reviews');
    expect(sql).toContain('proposed_by <> auth.uid()');
    expect(sql).toContain("v_status in ('rejected', 'provisional')");
    expect(sql).toContain("v_case.risk_tier = 'high'");
    expect(sql).toContain('v_effective := v_review.payload');
    expect(sql).toContain('legal.accreditation_docs');
    expect(sql).toContain('legal.signed_instruments');
    expect(sql).toContain('pending_decision_status');
    expect(sql).toContain('pending_decision_proposed_by_email');
  });
});
