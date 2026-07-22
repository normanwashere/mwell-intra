import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () => readFileSync(
  resolve(process.cwd(), '../..', 'supabase/migrations/20260722120000_legal_vendor_lifecycle_hardening.sql'),
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
    ]) expect(sql).toContain(field);
    expect(sql).toContain('reconcile_vendor_invite_lifecycle');
    expect(sql).toContain('accept_current_vendor_invite');
    expect(sql).toContain("coalesce(delivered_at, created_at) + interval '24 hours'");
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
