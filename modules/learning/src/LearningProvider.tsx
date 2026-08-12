"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@intra/auth";
import { MODULE_LIST, type Module, type UserRoles } from "@intra/rbac";
import { LEARNING_CATALOG, roleCurriculumFor } from "./catalog";
import {
  MemoryLearningRepository,
  SupabaseLearningRepository,
  type LearningRepository,
} from "./repository";
import type { LearningSnapshot, LockedCapability } from "./types";

const EMPTY_SNAPSHOT: LearningSnapshot = {
  curricula: [],
  progress: [],
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: new Date(0).toISOString(),
};
const EMPTY_USER_ROLES: Partial<UserRoles> = {};

function previewSnapshotForRoles(
  userRoles: Partial<UserRoles>,
): LearningSnapshot {
  const roleCurricula = MODULE_LIST.flatMap((module) =>
    (userRoles[module] ?? []).flatMap((role) => {
      const curriculum = roleCurriculumFor(module, role);
      return curriculum ? [curriculum] : [];
    }),
  );
  if (roleCurricula.length === 0) return EMPTY_SNAPSHOT;

  const requirementById = new Map(
    LEARNING_CATALOG.requirements.map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  const selectedRequirements = new Map(
    roleCurricula.flatMap((curriculum) =>
      curriculum.requirementIds.flatMap((requirementId) => {
        const requirement = requirementById.get(requirementId);
        return requirement ? [[requirement.id, requirement] as const] : [];
      }),
    ),
  );
  const refreshedAt = new Date().toISOString();
  const lockedCapabilities = new Map<string, LockedCapability>();
  for (const requirement of selectedRequirements.values()) {
    for (const capability of requirement.capabilityOutcomes) {
      const key = `${capability.module}:${capability.capability}`;
      const current = lockedCapabilities.get(key);
      lockedCapabilities.set(key, {
        capability,
        reason: "missing_certification",
        requirementIds: [
          ...new Set([...(current?.requirementIds ?? []), requirement.id]),
        ],
        canRequestEmergencyException: false,
      });
    }
  }

  return {
    curricula: roleCurricula.map((curriculum) => ({
      curriculum,
      requirements: curriculum.requirementIds.flatMap((requirementId) => {
        const requirement = requirementById.get(requirementId);
        return requirement ? [requirement] : [];
      }),
      source: "role",
    })),
    progress: [...selectedRequirements.values()].map((requirement) => ({
      assignmentRequirementId: `preview:${requirement.id}`,
      requirementId: requirement.id,
      requirementVersion: requirement.version,
      state: "not_started",
      attemptCount: 0,
      allowsSharedCompletion: requirement.kind === "orientation",
      updatedAt: refreshedAt,
    })),
    certifications: [],
    lockedCapabilities: [...lockedCapabilities.values()],
    refreshedAt,
  };
}

export interface LearningContextValue {
  snapshot: LearningSnapshot | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  resumeRequirementId: string | null;
  refresh(): Promise<void>;
  resume(requirementId: string): void;
  isLiveCapability(module: Module, capability: string): boolean;
  lockedReason(module: Module, capability: string): LockedCapability | null;
}

export const LearningContext = createContext<LearningContextValue | null>(null);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Learning status could not be loaded.";

export function LearningProvider({
  children,
  repository: injectedRepository,
}: {
  children: ReactNode;
  repository?: LearningRepository;
}) {
  const {
    profile,
    supabaseClient,
    userCapabilities = {},
    userRoles = EMPTY_USER_ROLES,
    roleCapabilities = {},
  } = useSession();
  const repository = useMemo<LearningRepository>(() => {
    if (injectedRepository) return injectedRepository;
    if (supabaseClient) return new SupabaseLearningRepository(supabaseClient);
    return new MemoryLearningRepository({
      snapshot: previewSnapshotForRoles(userRoles),
      runtime: "development",
    });
  }, [injectedRepository, supabaseClient, userRoles]);
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const snapshotRef = useRef<LearningSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(profile));
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeRequirementId, setResumeRequirementId] = useState<string | null>(
    null,
  );
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!profile) return;
    const requestGeneration = ++generation.current;
    if (!snapshotRef.current) setLoading(true);
    setError(null);
    try {
      const next = await repository.resolveAssignments();
      if (requestGeneration !== generation.current) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setStale(false);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(errorMessage(cause));
      setStale(snapshotRef.current !== null);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [profile, repository]);

  const authoritySignature = JSON.stringify({
    roles: userRoles,
    raw: roleCapabilities,
    effective: userCapabilities,
  });

  useEffect(() => {
    if (!profile) {
      generation.current += 1;
      snapshotRef.current = null;
      setSnapshot(null);
      setLoading(false);
      setStale(false);
      setError(null);
      return;
    }
    void refresh();
  }, [profile?.id, authoritySignature, refresh]);

  useEffect(() => {
    if (!profile) return;
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [profile, refresh]);

  const isLiveCapability = useCallback(
    (module: Module, capability: string) =>
      userCapabilities[module]?.includes(capability) === true,
    [userCapabilities],
  );

  const lockedReason = useCallback(
    (module: Module, capability: string) =>
      snapshot?.lockedCapabilities.find(
        (item) =>
          item.capability.module === module &&
          item.capability.capability === capability,
      ) ?? null,
    [snapshot],
  );

  const value = useMemo<LearningContextValue>(
    () => ({
      snapshot,
      loading,
      stale,
      error,
      resumeRequirementId,
      refresh,
      resume: setResumeRequirementId,
      isLiveCapability,
      lockedReason,
    }),
    [
      snapshot,
      loading,
      stale,
      error,
      resumeRequirementId,
      refresh,
      isLiveCapability,
      lockedReason,
    ],
  );

  return (
    <LearningContext.Provider value={value}>
      {children}
    </LearningContext.Provider>
  );
}

export function useLearning(): LearningContextValue {
  const value = useContext(LearningContext);
  if (!value) throw new Error("useLearning must be used within LearningProvider.");
  return value;
}
