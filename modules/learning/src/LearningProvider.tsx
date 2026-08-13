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
import { can, MODULE_LIST, type CapabilityFor, type Module, type UserRoles } from "@intra/rbac";
import { LEARNING_CATALOG, roleCurriculumFor } from "./catalog";
import {
  MemoryLearningRepository,
  SupabaseLearningRepository,
  type LearningRepository,
} from "./repository";
import type {
  AssessmentResult,
  AssessmentSubmission,
  LearningAttemptMode,
  LearningSnapshot,
  LockedCapability,
  PolicyAcknowledgmentInput,
  SupportRequestInput,
} from "./types";
import type { TrainingCheckpoint } from "./training/types";
import { createIdempotencyKey } from "./training/idempotency";
import { getTrainingAdapter } from "./training/registry";
import { scorePreviewAssessment } from "./content";

const EMPTY_SNAPSHOT: LearningSnapshot = {
  curricula: [],
  progress: [],
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: new Date(0).toISOString(),
};
const EMPTY_USER_ROLES: Partial<UserRoles> = {};
const CONFIRM_LOCAL_CAPABILITIES = async () => true;

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
  startingRequirementId: string | null;
  trainingError: string | null;
  activeTraining: ActiveTrainingRequirement | null;
  activeActivity: ActiveLearningActivity | null;
  refresh(): Promise<void>;
  resume(requirementId: string): Promise<void>;
  closeTraining(): void;
  closeActivity(): void;
  recordCheckpoint(event: TrainingCheckpoint): Promise<void>;
  submitAssessment(input: AssessmentSubmission): Promise<AssessmentResult>;
  acknowledgePolicy(input: PolicyAcknowledgmentInput): Promise<void>;
  requestSupport(input: SupportRequestInput): Promise<void>;
  isLiveCapability(module: Module, capability: string): boolean;
  lockedReason(module: Module, capability: string): LockedCapability | null;
}

export interface ActiveTrainingRequirement {
  requirementId: string;
  assignmentRequirementId: string;
  attemptId: string;
  mode: LearningAttemptMode;
  simulationId: string;
}

export interface ActiveLearningActivity {
  requirementId: string;
  assignmentRequirementId: string;
  kind: "assessment" | "policy";
  attemptId?: string;
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
    mode,
    supabaseClient,
    userCapabilities = {},
    userRoles = EMPTY_USER_ROLES,
    roleCapabilities = {},
    refreshCapabilities = CONFIRM_LOCAL_CAPABILITIES,
  } = useSession();
  const repository = useMemo<LearningRepository>(() => {
    if (injectedRepository) return injectedRepository;
    if (supabaseClient) return new SupabaseLearningRepository(supabaseClient);
    return new MemoryLearningRepository({
      snapshot: previewSnapshotForRoles(userRoles),
      runtime: "development",
      simulations: LEARNING_CATALOG.simulations,
      assess: (input) => ({ score: scorePreviewAssessment(input) }),
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
  const [startingRequirementId, setStartingRequirementId] = useState<string | null>(
    null,
  );
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [activeTraining, setActiveTraining] =
    useState<ActiveTrainingRequirement | null>(null);
  const [activeActivity, setActiveActivity] =
    useState<ActiveLearningActivity | null>(null);
  const generation = useRef(0);
  const startInFlight = useRef<string | null>(null);
  const startKeys = useRef(new Map<string, string>());
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const profileIdRef = useRef(profile?.id);
  profileIdRef.current = profile?.id;

  const authoritySignature = JSON.stringify({
    roles: userRoles,
    raw: roleCapabilities,
    effective: userCapabilities,
  });
  const principalSignature = `${profile?.id ?? "anonymous"}:${authoritySignature}`;
  const principalRef = useRef(principalSignature);
  const [snapshotPrincipal, setSnapshotPrincipal] = useState<string | null>(null);
  const [trainingPrincipal, setTrainingPrincipal] = useState<string | null>(null);
  if (principalRef.current !== principalSignature) {
    principalRef.current = principalSignature;
    generation.current += 1;
    snapshotRef.current = null;
    startInFlight.current = null;
    startKeys.current.clear();
  }

  const refresh = useCallback(async () => {
    if (!profile) return;
    const requestGeneration = ++generation.current;
    const requestPrincipal = principalRef.current;
    if (!snapshotRef.current) setLoading(true);
    setError(null);
    try {
      const next = await repository.resolveAssignments();
      if (
        requestGeneration !== generation.current ||
        requestPrincipal !== principalRef.current
      ) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setSnapshotPrincipal(requestPrincipal);
      setStale(false);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(errorMessage(cause));
      setStale(snapshotRef.current !== null);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [profile, repository]);

  useEffect(() => {
    if (!profile) {
      generation.current += 1;
      snapshotRef.current = null;
      setSnapshot(null);
      setSnapshotPrincipal(null);
      setLoading(false);
      setStale(false);
      setError(null);
      setTrainingError(null);
      setStartingRequirementId(null);
      setActiveTraining(null);
      setActiveActivity(null);
      setTrainingPrincipal(null);
      setResumeRequirementId(null);
      startInFlight.current = null;
      startKeys.current.clear();
      return;
    }
    setActiveTraining(null);
    setActiveActivity(null);
    setTrainingPrincipal(null);
    setResumeRequirementId(null);
    setTrainingError(null);
    void refresh();
  }, [profile?.id, authoritySignature, refresh]);

  useEffect(() => {
    if (!profile) return;
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [profile, refresh]);

  const visibleSnapshot =
    snapshotPrincipal === principalSignature ? snapshot : null;
  const visibleTraining =
    trainingPrincipal === principalSignature ? activeTraining : null;
  const visibleActivity =
    trainingPrincipal === principalSignature ? activeActivity : null;

  const isLiveCapability = useCallback(
    (module: Module, capability: string) => {
      if (mode === "supabase") {
        return userCapabilities[module]?.includes(capability) === true;
      }
      return (
        can(userRoles, module, capability as CapabilityFor<typeof module>) &&
        !visibleSnapshot?.lockedCapabilities.some(
          (item) => item.capability.module === module && item.capability.capability === capability,
        )
      );
    },
    [mode, userCapabilities, userRoles, visibleSnapshot],
  );

  const lockedReason = useCallback(
    (module: Module, capability: string) =>
      visibleSnapshot?.lockedCapabilities.find(
        (item) =>
          item.capability.module === module &&
          item.capability.capability === capability,
      ) ?? null,
    [visibleSnapshot],
  );

  const resume = useCallback(
    async (requirementId: string) => {
      if (startInFlight.current) return;
      setResumeRequirementId(requirementId);
      setTrainingError(null);
      const progress = snapshotRef.current?.progress.find(
        (item) => item.requirementId === requirementId,
      );
      if (!progress) {
        setTrainingError("This learning step is not assigned to your account.");
        return;
      }
      const requirement = snapshotRef.current?.curricula
        .flatMap((item) => item.requirements)
        .find((item) => item.id === requirementId);
      const isActivity = requirement?.kind === "assessment" || requirement?.kind === "policy";
      if (!requirement || (!isActivity && !requirement.simulationId)) {
        setTrainingError("This learning step does not have published training content yet.");
        return;
      }
      if (
        !isActivity &&
        requirement.kind !== "orientation" &&
        !getTrainingAdapter(requirement.simulationId!)
      ) {
        setTrainingError("Guided practice for this step is being prepared.");
        return;
      }
      const requestGeneration = generation.current;
      const requestProfileId = profileIdRef.current;
      const requestPrincipal = principalRef.current;
      if (!requestProfileId) return;
      const requestToken = createIdempotencyKey();
      startInFlight.current = requestToken;
      setStartingRequirementId(requirementId);
      try {
        const keyId = `${progress.assignmentRequirementId}:${progress.attemptCount + 1}`;
        const idempotencyKey =
          startKeys.current.get(keyId) ?? createIdempotencyKey();
        startKeys.current.set(keyId, idempotencyKey);
        const result = await repository.startRequirement({
          assignmentRequirementId: progress.assignmentRequirementId,
          idempotencyKey,
        });
        if (
          requestGeneration !== generation.current ||
          requestProfileId !== profileIdRef.current ||
          requestPrincipal !== principalRef.current
        ) {
          return;
        }
        setSnapshot((current) => {
          if (!current) return current;
          const next = {
            ...current,
            progress: current.progress.map((item) =>
              item.assignmentRequirementId === result.progress.assignmentRequirementId
                ? result.progress
                : item,
            ),
          };
          snapshotRef.current = next;
          return next;
        });
        if (isActivity) {
          if (requirement.kind === "assessment" && !result.attempt) {
            throw new Error("This assessment does not provide a governed attempt.");
          }
          setActiveTraining(null);
          setActiveActivity({
            requirementId,
            assignmentRequirementId: progress.assignmentRequirementId,
            kind: requirement.kind === "assessment" ? "assessment" : "policy",
            attemptId: result.attempt?.id,
          });
          setTrainingPrincipal(requestPrincipal);
          return;
        }
        if (!result.attempt) {
          throw new Error("This learning step does not provide a resumable attempt.");
        }
        setActiveTraining({
          requirementId,
          assignmentRequirementId: progress.assignmentRequirementId,
          attemptId: result.attempt.id,
          mode: result.attempt.mode,
          simulationId: requirement.simulationId!,
        });
        setActiveActivity(null);
        setTrainingPrincipal(requestPrincipal);
      } catch (cause) {
        if (
          requestGeneration === generation.current &&
          requestProfileId === profileIdRef.current &&
          startInFlight.current === requestToken
        ) {
          setTrainingError(errorMessage(cause));
          setActiveTraining(null);
          setActiveActivity(null);
        }
      } finally {
        if (startInFlight.current === requestToken) {
          startInFlight.current = null;
          if (
            requestGeneration === generation.current &&
            requestProfileId === profileIdRef.current &&
            requestPrincipal === principalRef.current
          ) {
            setStartingRequirementId(null);
          }
        }
      }
    },
    [repository],
  );

  const recordCheckpoint = useCallback(
    async (event: TrainingCheckpoint) => {
      const current = visibleTraining;
      if (
        !current ||
        current.assignmentRequirementId !== event.assignmentRequirementId ||
        current.attemptId !== event.attemptId ||
        current.simulationId !== event.scenarioId
      ) {
        throw new Error("Training checkpoint does not match the active requirement.");
      }
      const requestGeneration = generation.current;
      const requestProfileId = profileIdRef.current;
      const requestPrincipal = principalRef.current;
      if (!requestProfileId) throw new Error("Training session is no longer authenticated.");
      const canonicalProgress = await repository.checkpoint({
        assignmentRequirementId: event.assignmentRequirementId,
        attemptId: event.attemptId,
        simulationId: event.scenarioId,
        checkpointId: event.checkpointId,
        outcomeId: event.outcomeId,
        idempotencyKey: event.idempotencyKey,
      });
      const confirmed = await repository.resolveAssignments();
      if (
        requestGeneration !== generation.current ||
        requestProfileId !== profileIdRef.current ||
        requestPrincipal !== principalRef.current
      ) {
        throw new Error("Training authority changed before progress was confirmed.");
      }
      const readback = confirmed.progress.find(
        (item) => item.assignmentRequirementId === event.assignmentRequirementId,
      );
      if (!readback || readback.state !== canonicalProgress.state) {
        throw new Error("Training completion could not be confirmed by readback.");
      }
      if (
        event.terminal &&
        (!["passed", "waived"].includes(readback.state) ||
          !readback.completedAt ||
          readback.activeAttempt)
      ) {
        throw new Error("Training completion is not terminal in canonical readback.");
      }
      snapshotRef.current = confirmed;
      setSnapshot(confirmed);
      setSnapshotPrincipal(requestPrincipal);
      setStale(false);
      setError(null);
    },
    [repository, visibleTraining],
  );

  const confirmCommand = useCallback(
    async <T,>(
      command: () => Promise<T>,
      validate: (result: T, snapshot: LearningSnapshot) => void,
    ): Promise<T> => {
      let release!: () => void;
      const previous = commandQueue.current;
      commandQueue.current = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const requestGeneration = generation.current;
      const requestProfileId = profileIdRef.current;
      const requestPrincipal = principalRef.current;
      try {
        if (!requestProfileId) {
          throw new Error("Learning session is no longer authenticated.");
        }
        const result = await command();
        const confirmed = await repository.resolveAssignments();
        if (
          requestGeneration !== generation.current ||
          requestProfileId !== profileIdRef.current ||
          requestPrincipal !== principalRef.current
        ) {
          throw new Error("Learning authority changed before progress was confirmed.");
        }
        validate(result, confirmed);
        snapshotRef.current = confirmed;
        setSnapshot(confirmed);
        setSnapshotPrincipal(requestPrincipal);
        setStale(false);
        setError(null);
        const capabilitiesCurrent = await refreshCapabilities();
        if (!capabilitiesCurrent) {
          setStale(true);
          setError("Learning was saved, but your updated access could not be confirmed.");
        }
        return result;
      } finally {
        release();
      }
    },
    [refreshCapabilities, repository],
  );

  const submitAssessment = useCallback(
    (input: AssessmentSubmission) =>
      confirmCommand(() =>
        repository.submitAssessment({
          ...input,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        }),
        (result, confirmed) => {
          const progress = confirmed.progress.find(
            (item) => item.assignmentRequirementId === input.assignmentRequirementId,
          );
          if (!progress || progress.state !== result.state) {
            throw new Error("Assessment result could not be confirmed by readback.");
          }
        },
      ),
    [confirmCommand, repository],
  );

  const acknowledgePolicy = useCallback(
    (input: PolicyAcknowledgmentInput) =>
      confirmCommand(() =>
        repository.acknowledgePolicy({
          ...input,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        }),
        (_result, confirmed) => {
          const progress = confirmed.progress.find(
            (item) => item.assignmentRequirementId === input.assignmentRequirementId,
          );
          if (
            !progress ||
            !["passed", "waived"].includes(progress.state) ||
            !progress.completedAt
          ) {
            throw new Error("Policy acknowledgment could not be confirmed by readback.");
          }
        },
      ),
    [confirmCommand, repository],
  );

  const requestSupport = useCallback(
    (input: SupportRequestInput) =>
      confirmCommand(() =>
        repository.requestSupport({
          ...input,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        }),
        (_result, confirmed) => {
          const progress = confirmed.progress.find(
            (item) => item.assignmentRequirementId === input.assignmentRequirementId,
          );
          if (!progress || progress.state !== "needs_support") {
            throw new Error("Support request could not be confirmed by readback.");
          }
        },
      ),
    [confirmCommand, repository],
  );

  const closeTraining = useCallback(() => {
    setActiveTraining(null);
    setTrainingPrincipal(null);
    setResumeRequirementId(null);
    setTrainingError(null);
  }, []);

  const closeActivity = useCallback(() => {
    setActiveActivity(null);
    setTrainingPrincipal(null);
    setResumeRequirementId(null);
    setTrainingError(null);
  }, []);

  const value = useMemo<LearningContextValue>(
    () => ({
      snapshot: visibleSnapshot,
      loading,
      stale,
      error,
      resumeRequirementId,
      startingRequirementId,
      trainingError,
      activeTraining: visibleTraining,
      activeActivity: visibleActivity,
      refresh,
      resume,
      closeTraining,
      closeActivity,
      recordCheckpoint,
      submitAssessment,
      acknowledgePolicy,
      requestSupport,
      isLiveCapability,
      lockedReason,
    }),
    [
      visibleSnapshot,
      loading,
      stale,
      error,
      resumeRequirementId,
      startingRequirementId,
      trainingError,
      visibleTraining,
      visibleActivity,
      refresh,
      resume,
      closeTraining,
      closeActivity,
      recordCheckpoint,
      submitAssessment,
      acknowledgePolicy,
      requestSupport,
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

export function useOptionalLearning(): LearningContextValue | null {
  return useContext(LearningContext);
}
