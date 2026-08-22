import { expect, test } from '@playwright/test';
import { GovernedSourcingPglite, governedSourcing } from '../helpers/governed-sourcing-pglite';

test('disposable governed database executes sourcing controls through browser actions', async ({ page }) => {
  const database = new GovernedSourcingPglite();
  await database.start();
  try {
    await page.exposeFunction('governedRpc', async (actor: 'procurement' | 'reviewer' | 'operations' | 'vendor', name: string, payload: Record<string, unknown>) => {
      try { return { ok: true, result: await database.rpc(actor, name, payload) }; }
      catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }; }
    });
    await page.setContent(`<main><h1>Governed sourcing database</h1><output id="result"></output><script>window.run = async (actor,name,payload) => { const value = await window.governedRpc(actor,name,payload); document.querySelector('#result').textContent = JSON.stringify(value); return value; }</script></main>`);
    const call = (actor: 'procurement' | 'reviewer' | 'operations' | 'vendor', name: string, payload: Record<string, unknown>) => page.evaluate(([a, n, p]) => (window as any).run(a, n, p), [actor, name, payload] as const);
    const plan = { request_id: database.requestId, submission_deadline: governedSourcing.eventDeadline, intended_responses: 3, package_version: 'DB-RFQ-v1', package_hash: 'a'.repeat(64) };
    expect((await call('operations', 'save_sourcing_event', plan)).ok).toBe(false);
    const saved = await call('procurement', 'save_sourcing_event', plan);
    expect(saved.ok).toBe(true);
    const eventId = (saved.result as { id: string }).id;
    expect((await call('procurement', 'invite_sourcing_vendors', { sourcing_event_id: eventId, vendor_ids: database.vendorIds.slice(0, 3) })).ok).toBe(true);
    const normalSla = await call('procurement', 'sourcing_workspace', { request_id: database.requestId });
    expect((normalSla.result as any).event.communications.some((item: any) => item.communicationType === 'invitation' && item.acknowledgementState === 'pending')).toBe(true);
    await database.db.exec(`update procurement.solicitation_communications set sent_at = statement_timestamp() - interval '25 hours' where communication_type = 'invitation' and detail->>'recipientVendorId' = '${database.vendorIds[1]}'`);
    const overdueSla = await call('procurement', 'sourcing_workspace', { request_id: database.requestId });
    expect((overdueSla.result as any).event.communications.some((item: any) => item.communicationType === 'invitation' && item.acknowledgementState === 'overdue')).toBe(true);
    expect((await call('vendor', 'acknowledge_sourcing_invitation', { sourcing_event_id: eventId, vendor_id: database.vendorIds[0] })).ok).toBe(true);
    expect((await call('vendor', 'acknowledge_sourcing_invitation', { sourcing_event_id: eventId, vendor_id: database.vendorIds[0] })).result).toMatchObject({ replayed: true });
    expect((await call('procurement', 'transition_sourcing_event', { id: eventId, action: 'issue' })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: eventId, action: 'award', selected_vendor_id: database.vendorIds[0], closure_note: 'Too early' })).ok).toBe(false);
    expect((await call('procurement', 'record_solicitation_communication', { sourcing_event_id: eventId, communication_type: 'extension', extension_working_days: 7 })).ok).toBe(true);
    expect((await call('procurement', 'record_solicitation_communication', { sourcing_event_id: eventId, communication_type: 'extension', extension_working_days: 4 })).ok).toBe(false);
    expect((await call('procurement', 'transition_sourcing_event', { id: eventId, action: 'cancel', closure_note: 'Close extension-boundary case.' })).ok).toBe(true);
    const requotePlan = await call('procurement', 'save_sourcing_event', { ...plan, package_version: 'DB-RFQ-v2', package_hash: 'b'.repeat(64) });
    const requoteEventId = (requotePlan.result as { id: string }).id;
    expect((await call('procurement', 'invite_sourcing_vendors', { sourcing_event_id: requoteEventId, vendor_ids: database.vendorIds.slice(0, 3) })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'issue' })).ok).toBe(true);
    expect((await call('procurement', 'record_sourcing_response', { sourcing_event_id: requoteEventId, vendor_id: database.vendorIds[0], received_at: '2026-08-22T00:00:00.000Z', proposal_storage_path: 'proposal.pdf', commercial: { amount: 100 }, technical: { score: 90 } })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'failed_bid', failed_bid_reason: 'insufficient_responses' })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'source_additional_and_requote', vendor_id: database.vendorIds[3], submission_deadline: '2030-01-22T00:00:00.000Z', package_version: 'DB-RFQ-v3', package_hash: 'c'.repeat(64) })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'failed_bid', failed_bid_reason: 'insufficient_responses' })).ok).toBe(true);
    expect((await call('procurement', 'submit_insufficient_bid_exception', { sourcing_event_id: requoteEventId, phase: 'evaluation', justification: 'Documented market outreach did not generate three usable compliant submissions.', price_reasonableness: 'Independent comparison confirms available pricing remains reasonable.' })).ok).toBe(true);
    const workspace = await call('procurement', 'sourcing_workspace', { request_id: database.requestId });
    const pack = await database.db.query<{ id: string }>(`select id from procurement.exception_packs order by id desc limit 1`);
    expect((await call('procurement', 'review_insufficient_bid_exception', { id: pack.rows[0]!.id, decision: 'approved', note: 'Self approval attempt.' })).ok).toBe(false);
    expect((await call('reviewer', 'review_insufficient_bid_exception', { id: pack.rows[0]!.id, decision: 'approved', note: 'Independent approval.' })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'evaluation' })).ok).toBe(true);
    expect((await call('procurement', 'transition_sourcing_event', { id: requoteEventId, action: 'award', selected_vendor_id: database.vendorIds[0], closure_note: 'Controlled exception path evaluated and awarded.' })).result).toMatchObject({ status: 'awarded' });
    expect(workspace.ok).toBe(true);
    await expect(page.locator('#result')).not.toBeEmpty();
  } finally { await database.close(); }
});
