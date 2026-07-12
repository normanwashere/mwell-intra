import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { TasksPage } from './TasksPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('TasksPage', () => {
  it('separates due, blocked and completed work', async () => {
    renderWithProviders(<TasksPage />, { role: 'logistics_supervisor' });
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Due' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Blocked' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completed' })).toBeInTheDocument();
  });
});
