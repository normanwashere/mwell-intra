import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildSeed, type InventoryHold, type QualityInspectionSummary } from '@intra/data-kit';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { FulfillmentPage } from './FulfillmentPage';

const inspection: QualityInspectionSummary = {
  id: 'exact-inspection', sourceType: 'return', sourceId: 'physical-return', productId: 'shirt-l',
  quantity: 1, binId: 'bin-pasig-a1', disposition: 'hold', inspectedBy: 'reviewer', inspectedAt: '2026-11-05T00:00:00Z', evidenceCount: 1,
};
const hold: InventoryHold = {
  id: 'exact-hold', inspectionId: inspection.id, productId: 'shirt-l', locationId: 'loc-wh', binId: 'bin-pasig-a1',
  quantity: 1, status: 'active', reason: 'Check packaging', createdBy: 'reviewer', createdAt: '2026-11-05T00:00:00Z',
};
function fixture(quantity = 1) {
  const seed = buildSeed();
  seed.customerReturnCases = [{ id: 'case-1', sourceOrderId: 'order-1', productId: 'shirt-l', defectDescription: 'Damage',
    requestingDepartment: 'customer_service', status: 'submitted', resolution: 'pending', createdBy: 'service', createdAt: '2026-11-05' }];
  seed.returns = [{ id: 'physical-return', source: 'customer', sourceOrderId: 'order-1', returnCaseId: 'case-1',
    actor: 'receiver', createdAt: '2026-11-05', evidenceUrls: ['return/photo.jpg'],
    lines: [{ productId: 'shirt-l', quantity, reason: 'Damage', locationId: 'loc-wh', binId: 'bin-pasig-a1', disposition: 'hold' }] }];
  return makeRepo(seed);
}
async function open(repo: ReturnType<typeof fixture>, qualityAccess = true) {
  renderWithProviders(<FulfillmentPage />, { repo, source: 'supabase', role: 'warehouse_operator',
    capabilities: qualityAccess ? ['manage_returns', 'inspect_quality'] : ['manage_returns'], route: '/fulfillment?tab=returns' });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Record resolution' }));
  return screen.findByRole('dialog');
}

describe('permission-scoped return quality at resolution', () => {
  it.each([false, true])('does not infer clearance from partial or duplicate inspection coverage (duplicate=%s)', async duplicate => {
    const repo = fixture(2);
    const accepted = { ...inspection, disposition: 'accepted' as const };
    vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: duplicate ? [accepted, accepted] : [accepted] });
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [] });
    const dialog = await open(repo);
    const qc = within(dialog).getByRole('region', { name: 'Current return quality' });
    await waitFor(() => expect(qc).not.toHaveTextContent('Checking'));
    expect(qc).toHaveTextContent('Quality clearance is not verified');
    expect(qc).not.toHaveTextContent('no active linked holds');
  });
  it('shows exact linked hold/inspection and refreshes a release without losing form values or resolving stock', async () => {
    const repo = fixture();
    const inspections = vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [inspection, { ...inspection, id: 'foreign', sourceId: 'other-return' }] });
    const holds = vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [hold, { ...hold, id: 'foreign-hold', inspectionId: 'foreign' }] });
    const resolve = vi.spyOn(repo, 'resolveCustomerReturnCase');
    const dialog = await open(repo);
    const qc = await within(dialog).findByRole('region', { name: 'Current return quality' });
    expect(await within(qc).findByText(/active hold/i)).toBeVisible();
    expect(within(qc).getByRole('link', { name: /exact-inspection/ })).toHaveAttribute('href', '/quality?inspection=exact-inspection');
    expect(within(qc).getByRole('link', { name: /exact-hold/ })).toHaveAttribute('href', '/quality?inspection=exact-hold');
    expect(qc).not.toHaveTextContent('foreign');
    await userEvent.setup().selectOptions(within(dialog).getByLabelText('Quarantine bin'), 'bin-pasig-a1');
    inspections.mockResolvedValue({ rows: [{ ...inspection, disposition: 'accepted' }] });
    holds.mockResolvedValue({ rows: [{ ...hold, status: 'released', releasedBy: 'independent-reviewer', releasedAt: '2026-11-05T01:00:00Z' }] });
    await userEvent.setup().click(within(qc).getByRole('button', { name: 'Refresh return quality' }));
    expect(await within(qc).findByText(/accepted.*no active linked holds/i)).toBeVisible();
    expect(within(dialog).getByLabelText('Quarantine bin')).toHaveValue('bin-pasig-a1');
    expect(dialog).not.toHaveTextContent('Current Quality hold or release status is not available');
    expect(within(dialog).getByRole('region', { name: 'Workflow status' })).not.toHaveTextContent('Needs attention');
    expect(within(dialog).getByRole('region', { name: 'Workflow status' })).toHaveTextContent('awaiting resolution');
    expect(resolve).not.toHaveBeenCalled();
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(inspections).toHaveBeenCalledTimes(3));
  });

  it('does not query or infer clearance without effective QC read access', async () => {
    const repo = fixture();
    const inspections = vi.spyOn(repo, 'listQualityInspectionSummaries');
    const holds = vi.spyOn(repo, 'listHolds');
    const dialog = await open(repo, false);
    expect(within(dialog).getByRole('region', { name: 'Current return quality' })).toHaveTextContent(/access.*not.*verified/i);
    expect(inspections).not.toHaveBeenCalled();
    expect(holds).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('link', { name: /inspection|hold/i })).not.toBeInTheDocument();
  });

  it('distinguishes loading, failed, and missing reads from accepted stock', async () => {
    const repo = fixture();
    let reject!: (error: Error) => void;
    const inspections = vi.spyOn(repo, 'listQualityInspectionSummaries').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [] });
    const dialog = await open(repo);
    const qc = within(dialog).getByRole('region', { name: 'Current return quality' });
    expect(qc).toHaveTextContent(/checking/i);
    await act(async () => reject(new Error('offline')));
    expect(qc).toHaveTextContent(/could not be loaded.*not verified/i);
    inspections.mockResolvedValue({ rows: [] });
    await userEvent.setup().click(within(qc).getByRole('button', { name: 'Refresh return quality' }));
    expect(qc).toHaveTextContent(/not available.*not verified/i);
    expect(qc).not.toHaveTextContent(/accepted/i);
  });

  it('reads every page before claiming no active linked holds', async () => {
    const repo = fixture();
    vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [{ ...inspection, disposition: 'accepted' }] });
    vi.spyOn(repo, 'listHolds').mockImplementation(async query => query.cursor ? { rows: [hold] } : { rows: [], nextCursor: 'next' });
    const dialog = await open(repo);
    const qc = within(dialog).getByRole('region', { name: 'Current return quality' });
    expect(await within(qc).findByText(/active hold/i)).toBeVisible();
    expect(qc).not.toHaveTextContent('no active linked holds');
  });
});
