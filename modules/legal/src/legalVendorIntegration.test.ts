import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), '../..', path), 'utf8');

describe('Legal/vendor lifecycle UI integration', () => {
  it('uses the mode-aware draft repository and exposes autosave and discard recovery', () => {
    const page = source('modules/legal/src/pages/VendorApplicationPage.tsx');
    expect(page).toContain('createVendorApplicationDraftRepository');
    expect(page).not.toContain('repository.acceptInvitation()');
    expect(page).toContain('repository.save');
    expect(page).toContain('repository.discard');
    expect(page).toContain('Saved securely');
    expect(page).toContain('Discard draft');
    expect(page).not.toContain('localStorage');
  });

  it('settles an unknown application route into a vendor-safe recovery state', () => {
    const page = source('modules/legal/src/pages/VendorApplicationPage.tsx');
    expect(page).toContain('Application not available');
    expect(page).toContain('Return to vendor portal');
    expect(page.indexOf('if (!kase)')).toBeLessThan(page.indexOf('if (!application)'));
  });

  it('accepts invitation authority before rendering vendor routes and displays lifecycle metadata', () => {
    const store = source('modules/legal/src/localStore.ts');
    const page = source('modules/legal/src/pages/VendorApplicationPage.tsx');
    const app = source('modules/legal/src/LegalApp.tsx');
    expect(page).not.toContain('repository.acceptInvitation()');
    expect(app).toContain('VendorInvitationAcceptanceGate');
    expect(app).toContain('acceptPendingVendorInvitation');
    expect(app).toContain('hasVendorInvitationLinkEvidence');
    expect(store).toContain('expiresAt: row.expires_at');
    expect(store).toContain('linkGeneration: Number(row.link_generation');
  });

  it('uses in-flow mobile action regions and inline invite validation', () => {
    const invite = source('modules/legal/src/pages/InviteVendorPage.tsx');
    const detail = source('modules/legal/src/pages/CaseDetailPage.tsx');
    expect(invite).toContain('role="alert"');
    expect(invite).not.toContain('bottom-[calc(8.5rem+env(safe-area-inset-bottom))]');
    expect(detail).toContain('ok.decisionPending');
    expect(detail).toContain('Independent Legal confirmation required');
    expect(detail).toContain('Awaiting independent Legal confirmation');
  });
});
