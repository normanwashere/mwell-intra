import { describe, expect, it } from 'vitest';
import { closeWorkflowSummary } from './closeWorkflowSummary';
import type { FinanceCloseEntry } from './types';

const entry = { status: 'ready', preparedBy: 'preparer', postedBy: 'poster', evidenceUrl: 'https://example.com/evidence.pdf' } as FinanceCloseEntry;
describe('Finance close workflow summary', () => {
  it.each(['draft', 'ready', 'posted', 'reconciled', 'exception'])('describes %s with an explicit responsibility', status => {
    const summary = closeWorkflowSummary({ ...entry, status: status as FinanceCloseEntry['status'] }, 'independent', true);
    expect(summary.owner).toBeTruthy();
    expect(summary.nextStep).toBeTruthy();
  });
  it('keeps independent posting and reconciliation blockers visible', () => {
    expect(closeWorkflowSummary(entry, 'preparer', true).blocker).toContain('independent Finance user');
    expect(closeWorkflowSummary({ ...entry, status: 'posted' }, 'poster', true))
      .toMatchObject({ status: 'Posted / locked', owner: 'Independent Finance reconciler' });
    expect(closeWorkflowSummary({ ...entry, status: 'posted' }, 'poster', true).blocker).toContain('posters');
  });
  it('distinguishes permission, identity and evidence blockers without claiming readiness', () => {
    expect(closeWorkflowSummary(entry, 'independent', false).blocker).toContain('capability');
    expect(closeWorkflowSummary(entry, undefined, true).blocker).toContain('identity');
    expect(closeWorkflowSummary({ ...entry, evidenceUrl: undefined }, 'independent', true).blocker).toContain('Registered source evidence');
  });
  it('routes Event corrections upstream and leaves reconciled entries terminal', () => {
    expect(closeWorkflowSummary({ ...entry, status: 'exception', sourceRecordType: 'event_reconciliation' }, 'independent', true).owner).toBe('Event correction owner');
    expect(closeWorkflowSummary({ ...entry, status: 'reconciled' }, undefined, false))
      .toMatchObject({ owner: 'No further close action', tone: 'success' });
  });
  it('does not advise action for an unknown state', () => {
    expect(closeWorkflowSummary({ ...entry, status: 'unknown' as FinanceCloseEntry['status'] }, 'independent', true).status).toBe('Status unrecognized');
  });
});
