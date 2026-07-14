import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { renderWithProviders } from '@/test/renderWithProviders';

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

describe('AppShell navigation', () => {
  it('shows logistics modules including Receiving', async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    const sidebar = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(sidebar).getByRole('link', { name: /receiving/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: /cycle counts/i })).toBeInTheDocument();
    for (const group of ['Operate', 'Plan', 'Control', 'Analyze', 'Configure']) {
      const heading = within(sidebar).getByRole('heading', { name: group });
      expect(heading).toHaveAttribute('tabindex', '0');
    }
  });

  it('keeps Warehouse operations scoped and leaves Finance to the Intra shell', async () => {
    renderWithProviders(<AppShell>content</AppShell>, { role: 'finance' });
    const sidebar = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(sidebar).queryByRole('link', { name: /receiving/i })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: /^finance$/i })).not.toBeInTheDocument();
  });

  it('opens the account menu with a sign-out action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    await screen.findByRole('navigation', { name: 'Primary' });

    await user.click(screen.getByRole('button', { name: /account/i }));
    const dialog = await screen.findByRole('dialog', { name: /account/i });
    expect(within(dialog).getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('shows the demo data-source badge for the in-memory repo', async () => {
    renderWithProviders(<AppShell>content</AppShell>);
    expect(await screen.findByText('Demo')).toBeInTheDocument();
  });

  it('uses the exact mobile primary order and keeps More available', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    const mobile = await screen.findByRole('navigation', { name: 'Primary mobile' });
    expect(within(mobile).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Home',
      'Scan',
      'Tasks',
      'Inventory',
    ]);
    expect(within(mobile).getByRole('button', { name: 'More' })).toBeInTheDocument();

    await user.click(within(mobile).getByRole('button', { name: 'More' }));
    const drawer = await screen.findByRole('dialog', { name: /all tools/i });
    expect(within(drawer).getAllByText(/returns/i).length).toBeGreaterThan(0);
    expect(within(drawer).queryByText(/^Scan$/)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/^Tasks$/)).not.toBeInTheDocument();
  });

  it('keeps More reachable for roles without Scan or Tasks', async () => {
    renderWithProviders(<AppShell>content</AppShell>, { role: 'business_unit' });
    const mobile = await screen.findByRole('navigation', { name: 'Primary mobile' });
    expect(within(mobile).queryByRole('link', { name: 'Scan' })).not.toBeInTheDocument();
    expect(within(mobile).queryByRole('link', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(within(mobile).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quick scan' })).not.toBeInTheDocument();
  });

  it('opens the module alerts drawer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);
    await screen.findByRole('navigation', { name: 'Primary' });

    await user.click(screen.getByRole('button', { name: /module alerts/i }));
    expect(await screen.findByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
  });

  it('asks for confirmation before resetting demo data (WH-6)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    await screen.findByRole('navigation', { name: 'Primary' });

    await user.click(
      screen.getAllByRole('button', { name: /reset demo data/i })[0]!,
    );
    const dialog = await screen.findByRole('dialog', { name: /reset demo data\?/i });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    // Cancel keeps the data (no reload).
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
  });

  it('opens the dedicated scan route from the header shortcut', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell><LocationProbe /></AppShell>);
    await screen.findByRole('navigation', { name: 'Primary' });

    const quickScan = screen.getAllByRole('button', { name: /quick scan/i })[0];
    expect(quickScan).toBeDefined();
    await user.click(quickScan!);
    expect(await screen.findByRole('status', { name: /current route/i })).toHaveTextContent('/scan');
  });
});
