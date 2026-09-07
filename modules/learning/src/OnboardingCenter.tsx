"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link.js";
import { useRouter, useSearchParams } from "next/navigation.js";
import { useSession } from "@intra/auth";
import { MODULES } from "@intra/rbac";
import { Badge, Button, Icon, Sheet } from "@intra/ui";
import { useLearning } from "./LearningProvider";
import { OnboardingProgress } from "./OnboardingProgress";
import { TaskLearningSummary } from "./TaskLearningSummary";
import {
  projectTaskLearning,
  type SelectedLearningTask,
} from "./taskReadiness";
import { OnboardingTrainingSession } from "./OnboardingTrainingSession";
import { AssessmentRunner } from "./AssessmentRunner";
import { PolicyAcknowledgment } from "./PolicyAcknowledgment";
import { assessmentQuestionsFor, policyDocumentFor } from "./content";
import { getTrainingAdapter } from "./training/registry";
import { ROLE_CURRICULA, supportsEmbeddedTraining } from "./catalog";
import {
  sharedCompletionKey,
  requirementProgress,
} from "./requirementIdentity";
import { sanitizeOnboardingReturnPath } from "./orientationGate";
import type {
  Certification,
  RequirementDefinition,
  RequirementProgress,
  RequirementProgressState,
} from "./types";

const STATUS_LABEL: Record<RequirementProgressState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  passed: "Complete",
  failed_retryable: "Try again",
  needs_support: "Needs support",
  expired: "Expired",
  waived: "Waived",
};

const KIND_LABEL: Record<RequirementDefinition["kind"], string> = {
  orientation: "Orientation",
  policy: "Policy",
  tour: "Guided tour",
  scenario: "Practice",
  assessment: "Knowledge check",
  attestation: "Confirmation",
};

const capabilityLabel = (value: string) =>
  value
    .split("_")
    .map(
      (part) =>
        ({ po: "PO", doa: "DOA", rbac: "RBAC", rfp: "RFP" })[part] ??
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");

// Published role_curricula verified on UAT, 2026-09-06. These are presentation
// aliases only, not curriculum replacements or additional capability grants.
const publishedRoles = [
  "core.platform_admin",
  "events.admin",
  "events.coordinator",
  "events.finance_reviewer",
  "events.requester",
  "legal.admin",
  "legal.compliance",
  "legal.legal_reviewer",
  "procurement.admin",
  "procurement.approver",
  "procurement.finance",
  "procurement.procurement_officer",
  "procurement.requester",
  "product.contributor",
  "product.operations_partner",
  "product.product_owner",
  "warehouse.business_unit",
  "warehouse.finance",
  "warehouse.logistics_supervisor",
  "warehouse.marketing",
  "warehouse.operations",
  "warehouse.procurement",
  "warehouse.warehouse_supervisor",
  "core.vendor_portal",
];

function curriculumScope(
  curriculumId: string,
  curriculumVersion: number,
  moduleId?: string,
) {
  return ROLE_CURRICULA.find(
    (item) =>
      (!moduleId || item.module === moduleId) &&
      ((item.id === curriculumId && item.version === curriculumVersion) ||
        (publishedRoles.includes(`${item.module}.${item.role}`) &&
          curriculumId ===
            `${item.audience}.role.${item.module}.${item.role}.capability-practice.v1.curriculum` &&
          (curriculumVersion === 1 ||
            (item.module === "warehouse" &&
              item.role === "marketing" &&
              curriculumVersion === 2))) ||
        (item.module === "warehouse" &&
          item.role === "warehouse_operator" &&
          curriculumId ===
            "internal.warehouse.warehouse_operator.receiving-certification.v1" &&
          curriculumVersion === 1)),
  );
}

function certificationContext(certification: Certification): string {
  const module = MODULES[certification.capability.module];
  const curriculum = curriculumScope(
    certification.curriculumId,
    certification.curriculumVersion,
    certification.capability.module,
  );
  const role = curriculum
    ? Object.entries(module.roles).find(([key]) => key === curriculum.role)?.[1]
    : undefined;
  return `${module.label} / ${role?.label ?? "Role context unavailable"}`;
}

const lockLabel = (reason: string) =>
  reason === "retraining_required"
    ? "Retraining required"
    : reason === "expired_certification"
      ? "Certification expired"
      : "Certification required";

function vendorReturnPath(value: string | null): string {
  if (!value) return "/vendor";
  const url = new URL(value, "https://onboarding.invalid");
  const path = url.pathname;
  // Reject encoded path separators and traversal; query and fragment stay intact.
  if (
    url.origin !== "https://onboarding.invalid" ||
    /[%\\]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) <= 32) ||
    !(path === "/vendor" || path.startsWith("/vendor/")) ||
    path === "/vendor/onboarding" ||
    path.startsWith("/vendor/onboarding/")
  )
    return "/vendor";
  return `${path}${url.search}${url.hash}`;
}

function RequirementAction({
  requirement,
  progress,
  unavailableReason,
  onResume,
}: {
  requirement: RequirementDefinition;
  progress?: RequirementProgress;
  unavailableReason?: string;
  onResume(launcher: HTMLButtonElement): void;
}) {
  if (progress?.state === "needs_support") {
    return (
      <Link
        href="/knowledge?article=trouble-access-denied"
        className="btn-outline btn-sm"
      >
        Read recovery guidance
      </Link>
    );
  }
  if (progress && ["passed", "waived"].includes(progress.state)) {
    return (
      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        Done
      </span>
    );
  }
  const verb =
    progress?.state === "in_progress"
      ? "Resume"
      : progress?.state === "failed_retryable"
        ? "Try again"
        : progress?.state === "expired"
          ? "Expired"
          : "Start";
  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <Button
        size="sm"
        iconRight={unavailableReason ? undefined : "arrowRight"}
        className="w-full sm:w-auto"
        disabled={Boolean(unavailableReason)}
        onClick={(event) => onResume(event.currentTarget)}
      >
        {verb} {requirement.title}
      </Button>
      {unavailableReason && (
        <span className="max-w-64 text-xs font-medium text-muted">
          {unavailableReason}
        </span>
      )}
    </div>
  );
}

export function OnboardingCenter({
  audience = "internal",
  selectedTask,
}: {
  audience?: "internal" | "vendor";
  selectedTask?: SelectedLearningTask;
}) {
  const { profile, userRoles } = useSession();
  const assignedScopes = Object.entries(MODULES).flatMap(([moduleId, module]) =>
    Object.entries(module.roles).flatMap(([roleId, role]) =>
      (
        userRoles?.[moduleId as keyof typeof MODULES] as
          readonly string[] | undefined
      )?.includes(roleId)
        ? [{ moduleId, roleId, label: `${module.label} / ${role.label}` }]
        : [],
    ),
  );
  const {
    snapshot,
    loading,
    stale,
    error,
    refresh,
    resume,
    activeTraining,
    activeActivity,
    startingRequirementId,
    trainingError,
    closeTraining,
    closeActivity,
    recordCheckpoint,
    evaluateTrainingChoice,
  } = useLearning();
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRequirementId = searchParams.get("requirement");
  const requestedReturnPath = sanitizeOnboardingReturnPath(
    searchParams.get("next"),
  );
  const returnPath =
    audience === "vendor"
      ? vendorReturnPath(requestedReturnPath)
      : requestedReturnPath &&
          !requestedReturnPath.startsWith("/onboarding") &&
          !requestedReturnPath.startsWith("/vendor")
        ? requestedReturnPath
        : "/work";
  const requiredHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const trainingWasActive = useRef(false);
  const focusedRequirementRef = useRef<string | null>(null);
  const taskProjection = selectedTask
    ? projectTaskLearning(
        snapshot,
        audience,
        selectedTask.actionCapabilities,
        stale || Boolean(error) || loading,
      )
    : null;
  const ChecklistContainer = selectedTask ? "details" : "div";

  useEffect(() => {
    if (!activeTraining) return;
    const adapter = getTrainingAdapter(activeTraining.simulationId);
    if (adapter?.route) router.push(adapter.route);
  }, [activeTraining, router]);

  useEffect(() => {
    if (activeTraining) {
      trainingWasActive.current = true;
      return;
    }
    if (!trainingWasActive.current) return;
    trainingWasActive.current = false;
    requestAnimationFrame(() => {
      const launcher = launcherRef.current;
      if (launcher?.isConnected && !launcher.disabled) {
        launcher.focus();
        return;
      }
      if (selectedTask) {
        document
          .querySelector<HTMLElement>(
            "[data-onboarding-anchor='onboarding-required-steps']",
          )
          ?.focus();
      } else requiredHeadingRef.current?.focus();
    });
  }, [activeTraining, selectedTask]);

  const view = useMemo(() => {
    const requirements = new Map<string, RequirementDefinition>();
    const allRequirements = new Map<string, RequirementDefinition>();
    const sharedRequirements = new Set<string>();
    for (const effective of snapshot?.curricula ?? []) {
      if (effective.curriculum.audience !== audience) continue;
      for (const requirement of effective.requirements) {
        if (requirement.audience !== audience) continue;
        allRequirements.set(requirement.id, requirement);
        const sharedKey = sharedCompletionKey(requirement);
        if (sharedRequirements.has(sharedKey)) continue;
        sharedRequirements.add(sharedKey);
        requirements.set(sharedKey, requirement);
      }
    }
    const progress = new Map(
      [...requirements.values()].map((item) => [
        sharedCompletionKey(item),
        requirementProgress(item, snapshot?.progress ?? []),
      ]),
    );
    const completedSharedKeys = new Set(
      [...progress.values()].flatMap((item) => {
        if (!item || !["passed", "waived"].includes(item.state)) return [];
        const requirement = [...requirements.values()].find(
          (candidate) =>
            candidate.id === item.requirementId &&
            candidate.version === item.requirementVersion,
        );
        return requirement && requirement.version === item.requirementVersion
          ? [sharedCompletionKey(requirement)]
          : [];
      }),
    );
    const required = [...requirements.values()].filter(
      (item) => item.mandatory,
    );
    const completed = required.filter((item) =>
      ["passed", "waived"].includes(
        progress.get(sharedCompletionKey(item))?.state ?? "",
      ),
    ).length;
    const ordered = [...requirements.values()].sort((left, right) => {
      const rank = (item: RequirementDefinition) => {
        const state =
          progress.get(sharedCompletionKey(item))?.state ?? "not_started";
        return state === "in_progress"
          ? 0
          : state === "failed_retryable"
            ? 1
            : state === "not_started"
              ? 2
              : state === "needs_support"
                ? 3
                : 4;
      };
      return rank(left) - rank(right);
    });
    return {
      requirements: ordered,
      allRequirements,
      completedSharedKeys,
      progress,
      required,
      completed,
    };
  }, [audience, snapshot]);

  useEffect(() => {
    const routes = new Set(
      view.requirements.flatMap((requirement) => {
        if (!requirement.simulationId) return [];
        const route = getTrainingAdapter(requirement.simulationId)?.route;
        return route ? [route] : [];
      }),
    );
    for (const route of routes) router.prefetch(route);
  }, [router, view.requirements]);

  useEffect(() => {
    if (!requestedRequirementId) {
      focusedRequirementRef.current = null;
      return;
    }
    if (
      focusedRequirementRef.current === requestedRequirementId ||
      !view.requirements.some((item) => item.id === requestedRequirementId)
    )
      return;
    const target = document.getElementById(
      `onboarding-requirement-${encodeURIComponent(requestedRequirementId)}`,
    );
    if (!target) return;
    focusedRequirementRef.current = requestedRequirementId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
  }, [requestedRequirementId, view.requirements]);

  if (audience === "vendor" && profile?.kind !== "vendor") {
    return (
      <section
        role="alert"
        className="mx-auto max-w-2xl border-y border-line py-10 text-center"
      >
        <Icon name="lock" className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          Vendor onboarding unavailable
        </h1>
        <p className="mt-2 text-sm text-muted">
          This workspace is limited to signed-in vendor representatives.
        </p>
        <Link href="/" className="btn-outline mt-6 inline-flex">
          Return home
        </Link>
      </section>
    );
  }

  if (profile?.kind === "vendor" && audience === "internal") {
    return (
      <section className="mx-auto max-w-2xl border-y border-line py-10 text-center">
        <Icon name="building" className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          Vendor onboarding
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your accreditation training and evidence stay in the vendor workspace.
        </p>
        <Link
          href="/vendor/onboarding"
          className="btn-primary mt-6 inline-flex"
        >
          Continue to vendor onboarding
        </Link>
      </section>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="space-y-5" aria-live="polite">
        <h1 className="font-display text-2xl font-bold text-ink">
          Role onboarding
        </h1>
        <div className="h-28 animate-pulse rounded-lg bg-inset" />
        <p className="text-sm text-muted">Loading your onboarding</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl border-y border-rose-300 py-10 text-center dark:border-rose-800"
      >
        <Icon
          name="alert"
          className="mx-auto h-8 w-8 text-rose-700 dark:text-rose-300"
        />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          Onboarding unavailable
        </h1>
        <p className="mt-2 text-sm text-muted">
          {error ?? "Current learning status could not be confirmed."}
        </p>
        <Button
          variant="outline"
          className="mt-6"
          icon="rotate"
          onClick={() => void refresh()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (view.requirements.length === 0 && !selectedTask) {
    return (
      <div className="mx-auto max-w-2xl border-y border-line py-10 text-center">
        <Icon name="clipboard" className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          No onboarding assigned yet
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your authorized workspace remains available. Learning requirements
          apply to the actions that need them.
        </p>
        <Link href={returnPath} className="btn-outline mt-6 inline-flex">
          Return to workspace
        </Link>
      </div>
    );
  }

  const assignedContextFor = (requirement: RequirementDefinition) =>
    [
      ...new Set(
        snapshot.curricula
          .filter(
            (effective) =>
              effective.curriculum.audience === audience &&
              effective.requirements.some(
                (item) =>
                  sharedCompletionKey(item) ===
                  sharedCompletionKey(requirement),
              ),
          )
          .flatMap((effective) => {
            const scope = curriculumScope(
              effective.curriculum.id,
              effective.curriculum.version,
            );
            if (scope && scope.audience === audience) {
              const role = Object.entries(MODULES[scope.module].roles).find(
                ([id]) => id === scope.role,
              )?.[1];
              return role
                ? [`${MODULES[scope.module].label} / ${role.label}`]
                : [];
            }
            return assignedScopes
              .filter((assigned) =>
                ROLE_CURRICULA.some(
                  (item) =>
                    item.module === assigned.moduleId &&
                    item.role === assigned.roleId &&
                    item.audience === audience &&
                    item.requirementIds.includes(requirement.id),
                ),
              )
              .map((item) => item.label);
          }),
      ),
    ].join("; ") || "Assigned learning";

  const unavailableReasonFor = (requirement: RequirementDefinition) => {
    if (taskProjection?.status === "unavailable")
      return "Refresh task learning status before starting";
    const state = view.progress.get(sharedCompletionKey(requirement))?.state;
    if (state === "expired") return "Ask your manager to reassign this step";
    if (
      requirement.kind === "assessment" &&
      !assessmentQuestionsFor(requirement.id)
    ) {
      return "Knowledge check is being prepared";
    }
    if (requirement.kind === "policy" && !policyDocumentFor(requirement.id)) {
      return "Controlled policy is being prepared";
    }
    if (
      !["orientation", "assessment", "policy"].includes(requirement.kind) &&
      (!requirement.simulationId ||
        (!getTrainingAdapter(requirement.simulationId) &&
          !supportsEmbeddedTraining(requirement)))
    ) {
      return "Guided practice is being prepared";
    }
    const incomplete = requirement.prerequisiteIds.find((requirementId) => {
      const prerequisiteDefinition = view.allRequirements.get(requirementId);
      const prerequisiteState = prerequisiteDefinition
        ? view.progress.get(sharedCompletionKey(prerequisiteDefinition))?.state
        : undefined;
      if (["passed", "waived"].includes(prerequisiteState ?? "")) {
        return false;
      }
      const prerequisite = view.allRequirements.get(requirementId);
      return (
        !prerequisite ||
        !view.completedSharedKeys.has(sharedCompletionKey(prerequisite))
      );
    });
    if (!incomplete) return undefined;
    const title = snapshot.curricula
      .flatMap((curriculum) => curriculum.requirements)
      .find((item) => item.id === incomplete)?.title;
    return `Complete ${title ?? "the required previous step"} first`;
  };
  const next = view.requirements.find((requirement) => {
    const state =
      view.progress.get(sharedCompletionKey(requirement))?.state ??
      "not_started";
    return (
      !["passed", "waived", "needs_support", "expired"].includes(state) &&
      !unavailableReasonFor(requirement)
    );
  });
  const returnLabel = returnPath
    ? returnPath === "/work"
      ? "My Work"
      : (returnPath
          .split("/")
          .filter(Boolean)[0]
          ?.replace(/(^|[-_])\w/g, (part) =>
            part.replace(/[-_]/, "").toUpperCase(),
          ) ?? "your workspace")
    : null;
  const activeCertifications = snapshot.certifications.filter(
    (item) =>
      !item.revokedAt &&
      !item.supersededAt &&
      (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()),
  );
  const inactiveCertifications = snapshot.certifications.filter(
    (item) =>
      Boolean(item.revokedAt || item.supersededAt) ||
      Boolean(
        item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now(),
      ),
  );
  const activityRequirement = activeActivity
    ? view.requirements.find((item) => item.id === activeActivity.requirementId)
    : undefined;
  const activityProgress = activeActivity
    ? activityRequirement
      ? view.progress.get(sharedCompletionKey(activityRequirement))
      : undefined
    : undefined;
  const assessmentQuestions =
    activeActivity?.kind === "assessment"
      ? assessmentQuestionsFor(activeActivity.requirementId)
      : null;
  const policyDocument =
    activeActivity?.kind === "policy"
      ? policyDocumentFor(activeActivity.requirementId)
      : null;

  return (
    <div className="space-y-0">
      <Sheet
        open={Boolean(activeActivity)}
        onOpenChange={(open) => {
          if (!open) closeActivity();
        }}
        title={activityRequirement?.title ?? "Learning activity"}
        description="Complete this governed step to continue your role onboarding."
        side="adaptive"
        size="wide"
      >
        {activeActivity?.kind === "assessment" &&
          activityRequirement &&
          activityProgress &&
          assessmentQuestions && (
            <AssessmentRunner
              requirement={activityRequirement}
              progress={activityProgress}
              questions={assessmentQuestions}
            />
          )}
        {activeActivity?.kind === "policy" &&
          activityRequirement &&
          activityProgress &&
          policyDocument && (
            <PolicyAcknowledgment
              requirement={activityRequirement}
              progress={activityProgress}
              document={policyDocument}
            />
          )}
      </Sheet>
      {activeTraining &&
        !getTrainingAdapter(activeTraining.simulationId)?.route && (
          <OnboardingTrainingSession
            requirementTitle={
              view.requirements.find(
                (item) => item.id === activeTraining.requirementId,
              )?.title ?? "Role training"
            }
            assignmentRequirementId={activeTraining.assignmentRequirementId}
            attemptId={activeTraining.attemptId}
            scenarioId={activeTraining.simulationId}
            launcherRef={launcherRef}
            onCheckpoint={recordCheckpoint}
            onEvaluateChoice={evaluateTrainingChoice}
            onClose={closeTraining}
          />
        )}
      <header
        className={
          selectedTask
            ? "border-b border-line pb-3"
            : "border-b border-line pb-5"
        }
        data-onboarding-anchor="onboarding-role-context"
      >
        <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
          {audience === "vendor"
            ? "Accreditation and access"
            : "Learning and access"}
        </p>
        <h1
          className={
            selectedTask
              ? "mt-1 font-display text-xl font-bold text-ink"
              : "mt-1 font-display text-2xl font-bold text-ink sm:text-3xl"
          }
        >
          {audience === "vendor" ? "Vendor onboarding" : "Role onboarding"}
        </h1>
        {audience === "vendor" && profile?.name && (
          <p className="mt-2 min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
            {profile.name}
          </p>
        )}
        {!selectedTask && (
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Continue your authorized work while you learn. Only actions with
            required learning wait for completion; your permissions still apply.
          </p>
        )}
        <div
          className={
            selectedTask
              ? "mt-2 flex flex-wrap gap-2"
              : "mt-4 flex flex-wrap gap-2"
          }
        >
          {assignedScopes.map((scope) => (
            <Badge key={`${scope.moduleId}:${scope.roleId}`} tone="brand">
              {scope.label}
            </Badge>
          ))}
        </div>
      </header>

      {stale && (
        <div
          role="alert"
          className="flex flex-col gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <div>
            <p className="font-semibold">Learning status may be out of date</p>
            <p className="text-sm">
              {error ?? "The latest status could not be confirmed."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="rotate"
            onClick={() => void refresh()}
          >
            Refresh status
          </Button>
        </div>
      )}

      {trainingError && (
        <div
          role="alert"
          className="border-b border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100"
        >
          <p className="font-semibold">Training could not start</p>
          <p>{trainingError}</p>
        </div>
      )}

      {selectedTask && taskProjection && (
        <TaskLearningSummary
          task={selectedTask}
          projection={taskProjection}
          progress={snapshot.progress}
          onRefresh={refresh}
          loading={loading}
          refreshError={error}
          renderRequirement={(requirement) => (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-ink">
                  {requirement.title}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Assigned to: {assignedContextFor(requirement)} | Version{" "}
                  {requirement.version}
                </p>
                <p className="text-xs text-muted">
                  {
                    STATUS_LABEL[
                      view.progress.get(sharedCompletionKey(requirement))
                        ?.state ?? "not_started"
                    ]
                  }
                </p>
              </div>
              <RequirementAction
                requirement={requirement}
                progress={view.progress.get(sharedCompletionKey(requirement))}
                unavailableReason={
                  startingRequirementId === requirement.id
                    ? "Starting your governed attempt"
                    : unavailableReasonFor(requirement)
                }
                onResume={(launcher) => {
                  launcherRef.current = launcher;
                  void resume(requirement.id);
                }}
              />
            </div>
          )}
        />
      )}

      <section className="border-b border-line py-5">
        {selectedTask && (
          <p className="mb-2 text-xs font-semibold text-muted">
            All assigned mandatory learning
          </p>
        )}
        <OnboardingProgress
          completed={view.completed}
          total={view.required.length}
        />
        {returnPath && (
          <div
            className={
              selectedTask
                ? "mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                : "mt-5 flex flex-col gap-3 border-l-4 border-emerald-500 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            }
          >
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                Workspace access
              </p>
              <p className="mt-1 font-display text-base font-bold text-ink">
                Continue your authorized work
              </p>
              <p className="mt-1 text-sm text-muted">
                You can return before finishing this checklist. Requirements
                still apply to their specific actions.
              </p>
            </div>
            <a
              href={returnPath}
              className="btn-primary btn-sm inline-flex justify-center"
            >
              Continue to {returnLabel}
              <Icon name="arrowRight" className="h-4 w-4" />
            </a>
          </div>
        )}
        {next && !selectedTask && (
          <div className="mt-5 flex flex-col gap-3 border-l-4 border-brand-500 bg-brand-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                Next required action
              </p>
              <p className="mt-1 font-display text-base font-bold text-ink">
                {next.title}
              </p>
              <p className="mt-1 text-xs text-muted">
                Assigned to: {assignedContextFor(next)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {KIND_LABEL[next.kind]} |{" "}
                {next.mandatory ? "Required" : "Optional"}
              </p>
            </div>
            <RequirementAction
              requirement={next}
              progress={view.progress.get(sharedCompletionKey(next))}
              unavailableReason={
                startingRequirementId === next.id
                  ? "Starting your governed attempt"
                  : unavailableReasonFor(next)
              }
              onResume={(launcher) => {
                launcherRef.current = launcher;
                void resume(next.id);
              }}
            />
          </div>
        )}
      </section>

      <ChecklistContainer
        open={selectedTask ? Boolean(requestedRequirementId) : undefined}
        className="group"
      >
        {selectedTask && (
          <summary className="min-h-11 cursor-pointer border-b border-line py-3 text-sm font-semibold text-ink">
            All assigned learning
          </summary>
        )}
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section
            className="py-6 lg:pr-8"
            aria-labelledby="required-learning-heading"
            data-onboarding-anchor={
              selectedTask ? undefined : "onboarding-required-steps"
            }
          >
            <div className="mb-3">
              <h2
                id="required-learning-heading"
                ref={requiredHeadingRef}
                tabIndex={-1}
                className="font-display text-lg font-bold text-ink outline-none"
              >
                Your required steps
              </h2>
              <p className="text-sm text-muted">
                Assigned learning across your roles. Matching requirements
                appear once; prerequisites apply only where required.
              </p>
            </div>
            <ol className="border-t border-line">
              {view.requirements.map((requirement, index) => {
                const progress = view.progress.get(
                  sharedCompletionKey(requirement),
                );
                return (
                  <li
                    key={sharedCompletionKey(requirement)}
                    id={`onboarding-requirement-${encodeURIComponent(requirement.id)}`}
                    tabIndex={-1}
                    aria-current={
                      requestedRequirementId === requirement.id
                        ? "step"
                        : undefined
                    }
                    className={
                      requestedRequirementId === requirement.id
                        ? "grid gap-3 border-b border-brand-400 bg-brand-500/5 px-3 py-4 outline-none sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"
                        : "grid gap-3 border-b border-line py-4 outline-none sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"
                    }
                  >
                    <span className="tnum grid h-8 w-8 place-items-center rounded-full border border-line text-xs font-bold text-muted">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink">
                          {requirement.title}
                        </h3>
                        <Badge
                          tone={
                            progress?.state === "passed"
                              ? "emerald"
                              : progress?.state === "needs_support"
                                ? "rose"
                                : "slate"
                          }
                        >
                          {STATUS_LABEL[progress?.state ?? "not_started"]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Assigned to: {assignedContextFor(requirement)}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {KIND_LABEL[requirement.kind]} | Version{" "}
                        {requirement.version}
                        {requirement.maxAttempts
                          ? ` | ${progress?.attemptCount ?? 0} of ${requirement.maxAttempts} attempts used`
                          : ""}
                      </p>
                    </div>
                    {requirement.id === next?.id && !selectedTask ? (
                      <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                        Continue above
                      </span>
                    ) : (
                      <RequirementAction
                        requirement={requirement}
                        progress={progress}
                        unavailableReason={unavailableReasonFor(requirement)}
                        onResume={(launcher) => {
                          launcherRef.current = launcher;
                          void resume(requirement.id);
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <aside
            className="border-t border-line py-6 lg:border-l lg:border-t-0 lg:pl-8"
            aria-label="Action readiness"
          >
            <section>
              <h2 className="font-display text-base font-bold text-ink">
                Action readiness
              </h2>
              {snapshot.lockedCapabilities.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {snapshot.lockedCapabilities.map((lock) => (
                    <li
                      key={`${lock.capability.module}:${lock.capability.capability}`}
                      className="border-l-2 border-amber-500 pl-3"
                    >
                      <p className="font-semibold text-ink">
                        {MODULES[lock.capability.module].label} /{" "}
                        {capabilityLabel(lock.capability.capability)}
                      </p>
                      <p className="text-sm text-muted">
                        {lockLabel(lock.reason)}
                      </p>
                      {lock.canRequestEmergencyException && (
                        <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                          Temporary emergency access
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  No actions are waiting on learning. Existing permissions still
                  apply.
                </p>
              )}
            </section>

            <section className="mt-6 border-t border-line pt-6">
              <h2 className="font-display text-base font-bold text-ink">
                Certifications
              </h2>
              {activeCertifications.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {activeCertifications.map((certification) => (
                    <li key={certification.id}>
                      <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                        Certification active
                      </p>
                      <p className="text-sm text-ink">
                        {capabilityLabel(certification.capability.capability)}
                      </p>
                      <p className="break-words text-xs text-muted">
                        {certificationContext(certification)}
                      </p>
                      {certification.expiresAt && (
                        <p className="text-xs text-muted">
                          Valid until{" "}
                          {new Intl.DateTimeFormat("en-PH", {
                            dateStyle: "medium",
                          }).format(new Date(certification.expiresAt))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : inactiveCertifications.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Complete your first capability path to earn certification.
                </p>
              ) : null}
              {inactiveCertifications.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-line pt-4">
                  {inactiveCertifications.map((certification) => (
                    <li key={certification.id}>
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        {certification.revokedAt
                          ? "Certification revoked"
                          : certification.supersededAt
                            ? "Certification superseded"
                            : "Certification expired"}
                      </p>
                      <p className="text-sm text-ink">
                        {capabilityLabel(certification.capability.capability)}
                      </p>
                      <p className="break-words text-xs text-muted">
                        {certificationContext(certification)}
                      </p>
                      {certification.expiresAt &&
                        !certification.revokedAt &&
                        !certification.supersededAt && (
                          <p className="text-xs text-muted">
                            Expired{" "}
                            {new Intl.DateTimeFormat("en-PH", {
                              dateStyle: "medium",
                            }).format(new Date(certification.expiresAt))}
                          </p>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </ChecklistContainer>
    </div>
  );
}
