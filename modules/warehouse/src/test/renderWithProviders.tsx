import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { WarehouseProvider } from "@/app/store";
import { ThemeProvider } from "@/app/theme";
import { ToastProvider } from "@/components/ui";
import { SessionProvider } from "@/auth/session";
import { InMemoryRepository } from "@/data/inMemoryRepository";
import type { WarehouseData } from "@/data/repository";
import type { DataSource } from "@intra/data-kit";
import type { Role } from "@/domain/types";
import type { Capability } from "@/auth/roles";
import {
  LearningContext,
  type LearningContextValue,
  type LearningSnapshot,
} from "@intra/learning";

const certifiedTestSnapshot: LearningSnapshot = {
  curricula: [],
  progress: [],
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: "2026-08-13T00:00:00.000Z",
};

export const certifiedTestLearning: LearningContextValue = {
  snapshot: certifiedTestSnapshot,
  loading: false,
  stale: false,
  error: null,
  resumeRequirementId: null,
  startingRequirementId: null,
  trainingError: null,
  activeTraining: null,
  activeActivity: null,
  refresh: async () => undefined,
  refreshAccess: async () => true,
  resume: async () => undefined,
  closeTraining: () => undefined,
  closeActivity: () => undefined,
  recordCheckpoint: async () => undefined,
  submitAssessment: async () => ({
    assignmentRequirementId: "certified-test-assignment",
    passed: true,
    score: 100,
    attemptNumber: 1,
    state: "passed",
  }),
  acknowledgePolicy: async () => undefined,
  requestSupport: async () => undefined,
  isLiveCapability: () => true,
  lockedReason: () => null,
};

export function makeRepo(data?: WarehouseData) {
  return new InMemoryRepository(data, { storage: null });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    role = "logistics_supervisor",
    repo = makeRepo(),
    route = "/",
    source = "memory",
    capabilities,
    learning = certifiedTestLearning,
  }: {
    role?: Role;
    repo?: InMemoryRepository;
    route?: string;
    source?: DataSource;
    capabilities?: readonly Capability[];
    learning?: LearningContextValue;
  } = {},
): RenderResult {
  window.sessionStorage.setItem(
    "intra.memory-session.v1",
    JSON.stringify({
      profileId: `demo-${role}`,
      roles: { warehouse: [role] },
    }),
  );
  return render(
    <MemoryRouter
      initialEntries={[route]}
    >
      <SessionProvider
        config={{
          mode: "memory",
          profiles: [
            {
              id: `demo-${role}`,
              email: `${role}@mwell.com.ph`,
              kind: "employee",
              name: "Demo User",
              roles: { warehouse: [role] },
            },
          ],
        }}
      >
        <ThemeProvider>
          <ToastProvider>
            <LearningContext.Provider value={learning}>
              <WarehouseProvider
                repo={repo}
                source={source}
                initialRole={role}
                capabilities={capabilities}
              >
                {ui}
              </WarehouseProvider>
            </LearningContext.Provider>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}
