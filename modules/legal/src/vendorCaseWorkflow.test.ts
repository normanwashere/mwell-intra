import { describe, expect, it } from 'vitest';
import {
  applicationEditState,
  canRequestCorrection,
  lifecyclePresentation,
  recoverStaleDraft,
} from './vendorCaseWorkflow';

describe('vendor case workflow', () => {
  it('allows Legal to request a correction only from a submitted review state', () => {
    expect(canRequestCorrection('draft')).toBe(false);
    expect(canRequestCorrection('submitted')).toBe(true);
    expect(canRequestCorrection('under_review')).toBe(true);
    expect(canRequestCorrection('approved')).toBe(false);
  });

  it.each(['submitted', 'under_review'] as const)(
    'keeps a %s application read-only until Legal requests a correction',
    (status) => {
      expect(applicationEditState(status)).toEqual({
        editable: false,
        label: 'Submitted version is read-only',
      });
    },
  );

  it('reopens only the correction revision and identifies the superseded submission', () => {
    expect(
      applicationEditState('correction_requested', {
        requestedAt: '2026-08-14T09:00:00.000Z',
        requestedByEmail: 'legal@mwell.test',
        note: 'Replace the expired tax registration.',
        sourceVersion: 3,
        revision: 4,
      }),
    ).toEqual({
      editable: true,
      label: 'Correction revision 4',
      detail: 'Legal requested changes to submitted version 3: Replace the expired tax registration.',
    });
  });

  it('replaces a stale editor snapshot with the latest server revision without retrying the mutation', () => {
    expect(
      recoverStaleDraft(
        { version: 2, application: { company: { tradeName: 'Old name' } } },
        { version: 4, application: { company: { tradeName: 'Current name' } } },
      ),
    ).toEqual({
      recovered: true,
      version: 4,
      application: { company: { tradeName: 'Current name' } },
      message: 'This application changed elsewhere. The latest version has been loaded; review it before editing again.',
    });
  });

  it.each([
    ['renewal', 'completed', 'Renewal completed'],
    ['suspension', 'approved', 'Suspension approved'],
    ['offboarding', 'completed', 'Offboarding completed'],
    ['reinstatement', 'open', 'Reinstatement review open'],
  ] as const)('presents %s/%s lifecycle state consistently', (reviewType, status, label) => {
    expect(lifecyclePresentation(reviewType, status)).toMatchObject({ label });
  });
});
