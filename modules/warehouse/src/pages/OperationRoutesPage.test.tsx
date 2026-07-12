import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperationRoutesPage } from './OperationRoutesPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('OperationRoutesPage', () => {
  it('shows route policy and saves editable controls for Logistics', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<OperationRoutesPage />, { repo, role: 'logistics_supervisor' });
    const routes = await screen.findByLabelText('Operation routes');
    expect(within(routes).getByText(/vendor.*warehouse/i)).toBeInTheDocument();
    await user.click(within(routes).getByRole('button', { name: 'Edit route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit operation route' });
    expect(within(dialog).getByLabelText('Active')).toBeDisabled();
    expect(within(dialog).getByText(/last active route/i)).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Approval required'));
    await user.click(within(dialog).getByRole('button', { name: 'Save route' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit operation route' })).not.toBeInTheDocument());
    expect((await repo.getData()).operationRoutes?.[0]?.requiresApproval).toBe(true);
  });

  it('keeps the policy read-only for users without route-management permission', async () => {
    renderWithProviders(<OperationRoutesPage />, { role: 'operations' });
    const routes = await screen.findByLabelText('Operation routes');
    expect(within(routes).getByText(/online required/i)).toBeInTheDocument();
    expect(within(routes).queryByRole('button', { name: 'Edit route' })).not.toBeInTheDocument();
  });
});
