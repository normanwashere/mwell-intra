import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '@intra/auth';
import { ToastProvider } from '@intra/ui';
import { WarehouseApp } from './WarehouseApp';

const MEMORY_SESSION_KEY = 'intra.memory-session.v1';
const FIRST_RENDER_TIMEOUT = 10_000;

function renderSignedInWarehouse(path: string) {
  window.history.replaceState(window.history.state, '', path);
  window.sessionStorage.setItem(
    MEMORY_SESSION_KEY,
    JSON.stringify({
      profileId: 'grace',
      roles: { warehouse: ['procurement'] },
    }),
  );

  return render(
    <SessionProvider
      config={{
        mode: 'memory',
        profiles: [
          {
            id: 'grace',
            email: 'grace.velasco@mwell.com.ph',
            kind: 'employee',
            name: 'Grace',
            title: 'Procurement',
            roles: { warehouse: ['procurement'] },
          },
        ],
      }}
    >
      <ToastProvider>
        <WarehouseApp basename="/warehouse" />
      </ToastProvider>
    </SessionProvider>,
  );
}

describe('WarehouseApp basename handling', () => {
  it('normalizes bare /warehouse before mounting BrowserRouter', async () => {
    renderSignedInWarehouse('/warehouse');

    await waitFor(() => {
      expect(window.location.pathname).toBe('/warehouse/');
    });
    expect(await screen.findByRole('heading', { name: 'Grace' })).toBeInTheDocument();
    expect(screen.getByText(/warehouse dashboard/i)).toBeInTheDocument();
  }, FIRST_RENDER_TIMEOUT);
});
