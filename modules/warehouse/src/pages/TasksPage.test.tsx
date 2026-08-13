import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { TasksPage } from './TasksPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('TasksPage', () => {
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
