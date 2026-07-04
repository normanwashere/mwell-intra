import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { WarehouseProvider } from '@/app/store';
import { ThemeProvider } from '@/app/theme';
import { ToastProvider } from '@/components/ui';
import { SessionProvider } from '@/auth/session';
import { InMemoryRepository } from '@/data/inMemoryRepository';
import type { WarehouseData } from '@/data/repository';
import type { Role } from '@/domain/types';

export function makeRepo(data?: WarehouseData) {
  return new InMemoryRepository(data, { storage: null });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    role = 'logistics_supervisor' as Role,
    repo = makeRepo(),
    route = '/',
  }: { role?: Role; repo?: InMemoryRepository; route?: string } = {},
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
            <WarehouseProvider repo={repo} source="memory" initialRole={role}>
              {ui}
            </WarehouseProvider>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}
