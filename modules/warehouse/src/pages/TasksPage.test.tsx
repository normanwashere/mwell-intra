import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { TasksPage } from './TasksPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('TasksPage', () => {
  it('offers retry after a failed queue read without claiming the queue is empty', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listWarehouseTasks').mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue({ rows: [] });
    renderWithProviders(<TasksPage />, { repo, role: 'logistics_supervisor' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(screen.queryByText('No due tasks')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry task queue' }));
    expect(await screen.findByText('No due tasks')).toBeInTheDocument();
  });
  it('links a quality task to its source queue', async () => {
    const repo = makeRepo();
    const data = await repo.getData();
    const receipt = await repo.receiveStock({
      actor: 'receiver@mwell.com.ph',
      locationId: data.locations.find((location) => location.type === 'warehouse')!.id,
      lines: [{ productId: 'shirt-l', quantity: 1 }],
      receiptException: {
        type: 'non_po',
        reason: 'Emergency replenishment',
        evidenceUrls: ['memory/approved-emergency-request.pdf'],
      },
    });
    renderWithProviders(<TasksPage />, { repo, role: 'logistics_supervisor' });

    const sourceLink = (await screen.findAllByRole('link', { name: /open quality source/i }))
      .find((link) => link.getAttribute('href') === `/quality?source=${receipt.id}`);
    expect(sourceLink).toHaveAttribute(
      'href',
      `/quality?source=${receipt.id}`,
    );
  });

  it('separates due, blocked and completed work', async () => {
    renderWithProviders(<TasksPage />, { role: 'logistics_supervisor' });
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Due' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Blocked' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completed' })).toBeInTheDocument();
  });
});
