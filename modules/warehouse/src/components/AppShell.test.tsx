import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('AppShell navigation', () => {
  it('shows logistics modules including Receiving', async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    const sidebar = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(sidebar).getByRole('link', { name: /receiving/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: /cycle counts/i })).toBeInTheDocument();
  });

  it('hides receiving for the finance role', async () => {
    renderWithProviders(<AppShell>content</AppShell>, { role: 'finance' });
    const sidebar = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(sidebar).queryByRole('link', { name: /receiving/i })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: /finance/i })).toBeInTheDocument();
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

  it('opens the More drawer with all role tools', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: 'logistics_supervisor',
    });
    await screen.findByRole('navigation', { name: 'Primary' });

    await user.click(screen.getByRole('button', { name: /^more$/i }));
    const drawer = await screen.findByRole('dialog', { name: /all tools/i });
    expect(within(drawer).getAllByText(/returns/i).length).toBeGreaterThan(0);
  });

  it('opens the notifications drawer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);
    await screen.findByRole('navigation', { name: 'Primary' });

    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
  });

  it('opens the quick-scan sheet', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);
    await screen.findByRole('navigation', { name: 'Primary' });

    const quickScan = screen.getAllByRole('button', { name: /quick scan/i })[0];
    expect(quickScan).toBeDefined();
    await user.click(quickScan!);
    expect(await screen.findByRole('dialog', { name: /quick scan/i })).toBeInTheDocument();
  });
});
