import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventsPage } from './EventsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('EventsPage', () => {
  it('lists seeded events with consumption', async () => {
    renderWithProviders(<EventsPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Events');
    expect(within(list).getByText(/Makati Corporate/i)).toBeInTheDocument();
  });

  it('creates a new event', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EventsPage />, { role: 'operations' });
    await screen.findByLabelText('Events');

    await user.click(screen.getByRole('button', { name: /new event/i }));
    const dialog = await screen.findByRole('dialog', { name: /new event/i });
    await user.type(within(dialog).getByLabelText('Event name'), 'Cebu Caravan');
    await user.click(within(dialog).getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText('Cebu Caravan')).toBeInTheDocument();
    });
  });

  it('hides the new-event action for finance (read-only costing)', async () => {
    renderWithProviders(<EventsPage />, { role: 'finance' });
    await screen.findByLabelText('Events');
    expect(screen.queryByRole('button', { name: /new event/i })).not.toBeInTheDocument();
  });

  it('captures end date and site location on create', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EventsPage />, { role: 'operations' });
    await screen.findByLabelText('Events');

    await user.click(screen.getByRole('button', { name: /new event/i }));
    const dialog = await screen.findByRole('dialog', { name: /new event/i });
    expect(within(dialog).getByLabelText('End date')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Site location')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Event name'), 'Davao Fair');
    await user.type(within(dialog).getByLabelText('Start date'), '2026-08-01');
    await user.type(within(dialog).getByLabelText('End date'), '2026-08-03');
    await user.selectOptions(within(dialog).getByLabelText('Site location'), 'loc-cebu');
    await user.click(within(dialog).getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText('Davao Fair')).toBeInTheDocument();
    });
  });
});
