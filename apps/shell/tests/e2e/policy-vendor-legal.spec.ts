import { expect, test, type Page } from '@playwright/test';
import type { AccreditationCase } from '../../../../modules/legal/src/types';

const SESSION_KEY = 'intra.memory-session.v1';

async function installSession(
  page: Page,
  session: { profileId: string; roles: Record<string, string[]> },
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: session },
  );
}

test('vendor draft exposes the policy-aligned accreditation form without layout traps', async ({ page }) => {
  await installSession(page, {
    profileId: 'demo-vendor',
    roles: { core: ['vendor_portal'] },
  });
  // The standard Acme case is submitted and intentionally read-only.
  const draft: AccreditationCase = {
    id: 'policy-vendor-draft',
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'draft',
    openedAt: '2026-08-22T00:00:00.000Z',
    jurisdiction: 'PH',
    entityType: 'corporation',
    vendorCategory: 'medical_pharma',
    riskTier: 'medium',
    contractType: 'master_supply',
    expectedAnnualSpend: '1m_10m',
  };
  await page.addInitScript((kase) => {
    const key = 'intra.legal.v1.cases';
    const cases = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!cases.some((row: { id: string }) => row.id === kase.id)) {
      localStorage.setItem(key, JSON.stringify([...cases, kase]));
    }
  }, draft);
  await page.goto(`/vendor/cases/${draft.id}/application`);

  await expect(page.getByRole('heading', { name: 'Acme Medical Supplies, Inc.' })).toBeVisible();
  await expect(page.getByText('Vendor Accreditation Form v.2025')).toBeVisible();
  await expect(page.getByText('SEC registration, Articles of Incorporation and By-Laws')).toBeVisible();
  await expect(page.getByLabel('Company trade name')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign and submit' })).toBeDisabled();

  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    naTargets: Array.from(document.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('Mark N/A'))
      .map((button) => button.getBoundingClientRect().height),
    mobileActionOverlay: window.innerWidth < 768
      ? Array.from(document.querySelectorAll('button'))
          .filter((button) => ['Save draft', 'Sign and submit'].includes(button.textContent?.trim() ?? ''))
          .some((button) => button.getBoundingClientRect().top < window.innerHeight)
      : false,
  }));
  expect(geometry.overflow).toBe(false);
  expect(geometry.naTargets.length).toBeGreaterThan(0);
  expect(geometry.naTargets.every((height) => height >= 44)).toBe(true);
  expect(geometry.mobileActionOverlay).toBe(false);
});

test('vendor cannot edit or resubmit the standard submitted accreditation case', async ({ page }) => {
  await installSession(page, {
    profileId: 'demo-vendor',
    roles: { core: ['vendor_portal'] },
  });
  await page.goto('/vendor/cases/case_seed_001/application');
  await expect(page.getByText('Vendor Accreditation Form v.2025')).toBeVisible();
  await expect(page.getByLabel('Company trade name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign and submit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
});

test('Legal can review the submitted form but cannot edit vendor-owned facts', async ({ page }) => {
  await installSession(page, {
    profileId: 'demo-legal',
    roles: { core: ['staff'], legal: ['legal_reviewer'] },
  });
  await page.goto('/legal/cases/case_seed_001/application');
  await expect(page.getByText('Vendor Accreditation Form v.2025')).toBeVisible();
  await expect(page.getByLabel('Company trade name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign and submit' })).toHaveCount(0);
});
