import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualityPage } from './QualityPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

async function repositoryWithPendingReceipt() {
  const repo = makeRepo();
  const data = await repo.getData();
  const receipt = await repo.receiveStock({
    actor: 'receiver@mwell.com.ph',
    locationId: data.locations.find((location) => location.type === 'warehouse')!.id,
    supplierId: data.suppliers[0]!.id,
    lines: [{ productId: 'shirt-l', quantity: 2 }],
    evidenceUrls: ['data:image/png;base64,receipt'],
  });
  return { repo, receipt };
}

describe('QualityPage', () => {
  it('separates live inspection and hold-release capabilities', async () => {
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: 'quality-minimal-hold-001', sourceType: 'receipt', sourceId: receipt.id,
      productId: 'shirt-l', quantity: 1, disposition: 'hold', reason: 'Review needed',
      evidenceUrls: ['data:image/png;base64,hold'],
    });
    const inspectOnly = renderWithProviders(<QualityPage />, {
      repo, role: 'warehouse_operator', source: 'supabase', capabilities: ['inspect_quality'],
    });
    expect(await screen.findAllByRole('button', { name: 'Inspect' })).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('tab', { name: 'Holds' }));
    expect(screen.queryByRole('button', { name: 'Review hold' })).not.toBeInTheDocument();
    inspectOnly.unmount();

    renderWithProviders(<QualityPage />, {
      repo, role: 'warehouse_operator', source: 'supabase', capabilities: ['release_quality_hold'],
    });
    expect(await screen.findByRole('tab', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Inspect' })).toHaveLength(0);
    await userEvent.click(screen.getByRole('tab', { name: 'Holds' }));
    expect(await screen.findByRole('button', { name: 'Review hold' })).toBeInTheDocument();
  });

  it.each([
    ['warehouse_operator', /record inspection facts/i],
    ['warehouse_supervisor', /controlled exception disposition/i],
  ] as const)('renders canonical %s quality responsibilities', async (role, expectedContent) => {
    renderWithProviders(<QualityPage />, { role });
    expect(await screen.findByText(expectedContent)).toBeInTheDocument();
  });

  it('separates Operator fact capture from Supervisor exception disposition', async () => {
    const { repo } = await repositoryWithPendingReceipt();
    const { unmount } = renderWithProviders(<QualityPage />, { repo, role: 'operations' });
    expect(await screen.findByText(/record inspection facts/i)).toBeInTheDocument();
    expect(screen.getByText(/Supervisor decides quarantine or rejection/i)).toBeInTheDocument();
    unmount();

    renderWithProviders(<QualityPage />, { repo, role: 'logistics_supervisor' });
    expect(await screen.findByText(/controlled exception disposition/i)).toBeInTheDocument();
  });

  it('holds a pending receipt only after reason and evidence are supplied', async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    renderWithProviders(<QualityPage />, { repo, role: 'operations' });

    const queue = await screen.findByLabelText('Pending inspections');
    const sourceText = within(queue).getByText((content) => content.includes(receipt.id));
    const sourceRow = sourceText.closest('li');
    expect(sourceRow).not.toBeNull();
    const inspect = within(sourceRow!).getByRole('button', { name: 'Inspect' });
    await user.click(inspect);

    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    await user.selectOptions(within(dialog).getByLabelText('Disposition'), 'hold');
    expect(within(dialog).getByRole('button', { name: 'Submit inspection' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Packaging seal is broken');
    await user.upload(
      within(dialog).getByLabelText('Attach inspection evidence'),
      new File(['proof'], 'proof.png', { type: 'image/png' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Submit inspection' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inspect stock' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'Holds' }));
    expect(await screen.findByText('Packaging seal is broken')).toBeInTheDocument();
    expect(screen.getByText('On hold')).toBeInTheDocument();
  });

  it('shows hold custody and requires evidence before release', async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: 'quality-test-hold-001',
      sourceType: 'receipt',
      sourceId: receipt.id,
      productId: 'shirt-l',
      quantity: 1,
      disposition: 'hold',
      reason: 'Awaiting supplier confirmation',
      evidenceUrls: ['data:image/png;base64,hold'],
    });
    renderWithProviders(<QualityPage />, { repo, role: 'logistics_supervisor' });

    await user.click(await screen.findByRole('tab', { name: 'Holds' }));
    const holds = await screen.findByLabelText('Active holds');
    expect(within(holds).getByText(/created by/i)).toBeInTheDocument();
    await user.click(within(holds).getByRole('button', { name: 'Review hold' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review inventory hold' });
    expect(within(dialog).getByText(/separation of duties/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Release reason'), 'Supplier approved the packaging variance');
    expect(within(dialog).getByRole('button', { name: 'Release as accepted' })).toBeDisabled();
  });

  it('queues physical returns for inspection before putaway', async () => {
    const repo = makeRepo();
    const data = await repo.getData();
    await repo.recordReturn({
      actor: 'returns@mwell.com.ph',
      source: 'customer',
      lines: [{
        productId: 'shirt-l',
        quantity: 1,
        reason: 'unused / surplus',
        disposition: 'restock',
        locationId: data.locations.find((location) => location.type === 'warehouse')!.id,
      }],
      evidenceUrls: ['data:image/png;base64,return'],
    });
    renderWithProviders(<QualityPage />, { repo, role: 'operations' });

    const queue = await screen.findByLabelText('Pending inspections');
    expect(within(queue).getAllByText(/return/i).length).toBeGreaterThan(0);
    expect(within(queue).getAllByText(/event shirt \(l\)/i).length).toBeGreaterThan(0);
  });

  it('creates an evidence-backed vendor return from a rejected hold', async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: 'quality-vendor-ui-001',
      sourceType: 'receipt',
      sourceId: receipt.id,
      productId: 'shirt-l',
      quantity: 1,
      disposition: 'vendor_return',
      reason: 'Wrong item supplied',
      evidenceUrls: ['data:image/png;base64,rejected'],
    });
    renderWithProviders(<QualityPage />, {
      repo,
      role: 'warehouse_operator',
      source: 'supabase',
      capabilities: ['manage_returns'],
    });

    await user.click(await screen.findByRole('tab', { name: 'Holds' }));
    await user.click(within(await screen.findByLabelText('Active holds')).getByRole('button', { name: 'Review hold' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review inventory hold' });
    expect(within(dialog).getByLabelText('Supplier')).toHaveValue((await repo.getData()).suppliers[0]!.id);
    await user.type(within(dialog).getByLabelText('Vendor return reference'), 'RMA-UI-001');
    await user.type(within(dialog).getByLabelText('Vendor return reason'), 'Rejected at incoming inspection');
    await user.upload(
      within(dialog).getByLabelText('Attach vendor return evidence'),
      new File(['rma'], 'rma.png', { type: 'image/png' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create vendor return' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review inventory hold' })).not.toBeInTheDocument());
    expect(await screen.findByText('RMA-UI-001')).toBeInTheDocument();
    expect(screen.getByText('Ready for handoff')).toBeInTheDocument();
  });
});
