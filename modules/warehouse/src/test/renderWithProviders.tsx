import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { WarehouseProvider } from '@/app/store';
import { ThemeProvider } from '@/app/theme';
import { ToastProvider } from '@/components/ui';
import { SessionProvider } from '@/auth/session';
import { InMemoryRepository } from '@/data/inMemoryRepository';
import type { WarehouseData } from '@/data/repository';
import type { DataSource } from '@intra/data-kit';
import type { Role } from '@/domain/types';
import type { Capability } from '@/auth/roles';

export function makeRepo(data?: WarehouseData) {
  return new InMemoryRepository(data, { storage: null });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    role = 'logistics_supervisor',
    repo = makeRepo(),
    route = '/',
    source = 'memory',
    capabilities,
  }: {
    role?: Role;
    repo?: InMemoryRepository;
    route?: string;
    source?: DataSource;
    capabilities?: readonly Capability[];
  } = {},
): RenderResult {
  return render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SessionProvider
        config={{
          mode: 'memory',
          profiles: [
            {
              id: `demo-${role}`,
              email: `${role}@mwell.com.ph`,
              kind: 'employee',
              name: 'Demo User',
              roles: { warehouse: [role] },
            },
          ],
        }}
      >
        <ThemeProvider>
          <ToastProvider>
            <WarehouseProvider
              repo={repo}
              source={source}
              initialRole={role}
              capabilities={capabilities}
            >
              {ui}
            </WarehouseProvider>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}
