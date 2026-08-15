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
    const tabs = source('modules/legal/src/components/LegalTabs.tsx');
    expect(invite).toContain('role="alert"');
    expect(invite).not.toContain('bottom-[calc(8.5rem+env(safe-area-inset-bottom))]');
    expect(invite).toContain('className="flex min-h-11 w-full items-center');
    expect(tabs).toContain('md:sticky');
    expect(tabs).not.toContain('className="sticky ');
    expect(detail).toContain('ok.decisionPending');
    expect(detail).toContain('Independent Legal confirmation required');
    expect(detail).toContain('Awaiting independent Legal confirmation');
  });

  it('keeps checklist actions as sibling controls instead of nested button cards', () => {
    const detail = source('modules/legal/src/pages/CaseDetailPage.tsx');

    expect(detail).not.toContain("role={interactive ? 'button' : undefined}");
    expect(detail).not.toContain('tabIndex={interactive ? 0 : undefined}');
    expect(detail).toContain('aria-label={actionLabel}');
    expect(detail).toContain('min-h-11 min-w-11');
  });

  it('captures technology-service status before the tailored invite preview', () => {
    const invite = source('modules/legal/src/pages/InviteVendorPage.tsx');
    expect(invite).toContain('technologyServiceProvider');
    expect(invite).toContain('This is a technology service provider');
    expect(invite.indexOf('This is a technology service provider')).toBeLessThan(
      invite.indexOf('Requirements preview'),
    );
  });

  it('collects lifecycle rationale, reinstatement, and a new renewal expiry', () => {
    const lifecycle = source('modules/legal/src/components/VendorLifecyclePanel.tsx');
    expect(lifecycle).toContain('<option value="reinstatement">Reinstatement</option>');
    expect(lifecycle).toContain('Decision rationale');
    expect(lifecycle).toContain('New accreditation expiry');
    expect(lifecycle).toContain('expires_at: decision.expiresAt');
    expect(lifecycle).not.toContain('recorded from the Legal lifecycle workspace');
  });

  it('requires an explicit accreditation decision rationale in the review sheet', () => {
    const detail = source('modules/legal/src/pages/CaseDetailPage.tsx');
    expect(detail).toContain('Decision rationale (required)');
    expect(detail).toContain("if (!decisionNote.trim())");
    expect(detail).toContain('disabled={!decisionSignature || !decisionNote.trim()}');
  });
});
