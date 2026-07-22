import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '@intra/auth';
import { ToastProvider } from '@intra/ui';
import { WarehouseApp } from './WarehouseApp';

const MEMORY_SESSION_KEY = 'intra.memory-session.v1';
const FIRST_RENDER_TIMEOUT = 10_000;

function renderSignedInWarehouse(
  path: string,
  warehouseRoles: string[] = ['procurement'],
) {
  window.history.replaceState(window.history.state, '', path);
  window.sessionStorage.setItem(
    MEMORY_SESSION_KEY,
    JSON.stringify({
      profileId: 'grace',
      roles: { warehouse: warehouseRoles },
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
            roles: { warehouse: warehouseRoles },
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
  it(
    'normalizes bare /warehouse before mounting BrowserRouter',
    async () => {
      renderSignedInWarehouse('/warehouse');

      await waitFor(() => {
        expect(window.location.pathname).toBe('/warehouse/');
      });
      expect(
        await screen.findByRole('heading', {
          name: /procurement warehouse dashboard/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/welcome back, grace/i)).toBeInTheDocument();
    },
    FIRST_RENDER_TIMEOUT,
  );

  it(
    'accepts canonical Warehouse roles from a validated session claim',
    async () => {
      renderSignedInWarehouse('/warehouse/', ['warehouse_operator']);

      expect(
        await screen.findByRole('heading', {
          name: /warehouse floor operations/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/welcome back, grace/i)).toBeInTheDocument();
    },
    FIRST_RENDER_TIMEOUT,
  );

  it(
    'redirects the retired analytics URL to the governed data workspace',
    async () => {
      renderSignedInWarehouse('/warehouse/analytics', ['bi_analyst']);

      expect(
        await screen.findByRole('heading', { name: 'Data & Reports' }),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(window.location.pathname).toBe('/warehouse/data');
      });
    },
    FIRST_RENDER_TIMEOUT,
  );

  it(
    'rejects an unknown Warehouse role instead of casting the claim',
    async () => {
      renderSignedInWarehouse('/warehouse/', ['made_up_role']);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /no warehouse access/i,
      );
    },
    FIRST_RENDER_TIMEOUT,
  );
});
