import { describe, it, expect } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventDetailPage } from './EventDetailPage';
import type { Role } from '@/domain/types';
import { renderWithProviders } from '@/test/renderWithProviders';

function renderEvent(role: Role = 'finance') {
  return renderWithProviders(
    <Routes>
      <Route path="/events/:id" element={<EventDetailPage />} />
    </Routes>,
    { route: '/events/evt-makati', role },
  );
}

describe('EventDetailPage', () => {
  it('renders event summary and costing for a seeded event', async () => {
    renderEvent('finance');
    expect(await screen.findByRole('heading', { name: /Makati Corporate/i })).toBeInTheDocument();
    expect(screen.getByText(/event costing/i)).toBeInTheDocument();
    expect(screen.getByText('Units consumed')).toBeInTheDocument();
    expect(screen.getByLabelText('Event allocations')).toBeInTheDocument();
  });

  it('hides the reserve CTA for roles without reserve_allocate', async () => {
    renderEvent('finance');
    await screen.findByRole('heading', { name: /Makati Corporate/i });
    expect(
      screen.queryByRole('button', { name: /reserve for this event/i }),
    ).not.toBeInTheDocument();
  });

  it('reserves stock for the event via the CTA', async () => {
    const user = userEvent.setup();
    renderEvent('operations');
    await screen.findByRole('heading', { name: /Makati Corporate/i });

    await user.click(screen.getByRole('button', { name: /reserve for this event/i }));
    const dialog = await screen.findByRole('dialog', { name: /reserve for this event/i });
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'doctor-token');
    await user.click(within(dialog).getByRole('button', { name: /^reserve$/i }));

    await waitFor(() => {
      expect(screen.getByText(/reserved 1×/i)).toBeInTheDocument();
    });
  });
});
