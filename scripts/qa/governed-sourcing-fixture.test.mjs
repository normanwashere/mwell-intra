import assert from 'node:assert/strict';
import test from 'node:test';
import { GovernedSourcingPglite, governedSourcing } from '../../apps/shell/tests/helpers/governed-sourcing-pglite.ts';

test('browser fixture boots the complete policy tail and preserves effective sourcing guards', async () => {
  const fixture = new GovernedSourcingPglite();
  try {
    await fixture.start();
    const triggers = await fixture.db.query(`select tgname, tgenabled from pg_trigger
      where tgrelid = 'procurement.sourcing_events'::regclass and not tgisinternal`);
    assert.ok(triggers.rows.some(row => /award/.test(row.tgname) && row.tgenabled === 'O'));
    await fixture.db.exec('set role service_role');
    await assert.rejects(fixture.db.query('delete from procurement.sourcing_events'), /permission denied/i);
    await fixture.db.exec('reset role');
    const plan = { request_id: fixture.requestId, submission_deadline: governedSourcing.eventDeadline,
      intended_responses: 3, package_version: 'fixture-v1', package_hash: 'a'.repeat(64) };
    await assert.rejects(fixture.rpc('operations', 'save_sourcing_event', plan), /Not authorized to manage sourcing/i);
    const event = await fixture.rpc('procurement', 'save_sourcing_event', plan);
    assert.equal(event.status, 'draft');
    await fixture.db.query('update core.vendors set accreditation_status = $1 where id = $2', ['suspended', fixture.vendorIds[0]]);
    await assert.rejects(fixture.rpc('procurement', 'invite_sourcing_vendors', { sourcing_event_id: event.id, vendor_ids: fixture.vendorIds.slice(0, 3) }), /eligib|suspended/i);
    await fixture.db.query('update core.vendors set accreditation_status = $1 where id = $2', ['approved', fixture.vendorIds[0]]);
    await fixture.rpc('procurement', 'invite_sourcing_vendors', { sourcing_event_id: event.id, vendor_ids: fixture.vendorIds.slice(0, 3) });
    const workspace = await fixture.rpc('procurement', 'sourcing_workspace', { request_id: fixture.requestId });
    assert.equal(workspace.event.responses.length, 3);
    assert.ok(workspace.event.communications.every(item => item.acknowledgementState === 'pending'));
    await fixture.rpc('procurement', 'transition_sourcing_event', { id: event.id, action: 'issue' });
    await fixture.rpc('procurement', 'record_sourcing_response', { sourcing_event_id: event.id,
      vendor_id: fixture.vendorIds[0], received_at: '2026-08-22T00:00:00.000Z', proposal_storage_path: 'fixture/proposal.pdf', commercial: { amount: 100 } });
    await fixture.rpc('procurement', 'transition_sourcing_event', { id: event.id, action: 'failed_bid', failed_bid_reason: 'insufficient_responses' });
    const pack = await fixture.rpc('procurement', 'submit_insufficient_bid_exception', { sourcing_event_id: event.id,
      phase: 'evaluation', justification: 'Documented market outreach did not generate three usable submissions.', price_reasonableness: 'Independent comparison supports the available price.' });
    await assert.rejects(fixture.rpc('procurement', 'review_insufficient_bid_exception', { id: pack.id, decision: 'approved', note: 'Self approval' }), /author cannot approve their own/i);
    await fixture.rpc('reviewer', 'review_insufficient_bid_exception', { id: pack.id, decision: 'approved', note: 'Independent approval' });
    await fixture.rpc('procurement', 'transition_sourcing_event', { id: event.id, action: 'evaluation' });
    const award = { id: event.id, action: 'award', selected_vendor_id: fixture.vendorIds[0], closure_note: 'Evidence-backed award' };
    await assert.rejects(fixture.rpc('procurement', 'transition_sourcing_event', award), /approved best-value recommendation/i);
    const tabulation = await fixture.rpc('procurement', 'save_commercial_tabulation', { sourcing_event_id: event.id,
      evidence_reference: 'fixture/tabulation.xlsx', entries: [{ vendor_id: fixture.vendorIds[0], quoted_amount: 100, evidence_reference: 'fixture/proposal.pdf' }] });
    const evaluation = await fixture.rpc('procurement', 'submit_technical_evaluation', { sourcing_event_id: event.id,
      vendor_id: fixture.vendorIds[0], evidence_reference: 'fixture/technical.pdf',
      criteria: ['technicalCompliance', 'quality', 'leadTime', 'totalLifecycleCost', 'warranty', 'support', 'price', 'paymentTerms', 'training']
        .map(criterion => ({ criterion, score: 90, evidence_reference: `fixture/${criterion}.pdf` })) });
    await fixture.rpc('procurement', 'submit_award_recommendation', { sourcing_event_id: event.id,
      evaluated_vendor_id: fixture.vendorIds[0], recommended_vendor_id: fixture.vendorIds[0],
      commercial_tabulation_id: tabulation.id, technical_evaluation_id: evaluation.id, rationale: 'Complete best-value evidence supports this vendor.' });
    assert.equal((await fixture.rpc('procurement', 'transition_sourcing_event', award)).status, 'awarded');
  } finally { await fixture.close(); }
});
