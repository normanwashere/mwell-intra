"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link.js";
import { useRouter, useSearchParams } from "next/navigation.js";
import { useSession } from "@intra/auth";
import { Badge, Button, Icon, Sheet } from "@intra/ui";
import { OPERATING_PERSONAS } from "./personas";
import { useLearning } from "./LearningProvider";
import { OnboardingProgress } from "./OnboardingProgress";
import { OnboardingTrainingSession } from "./OnboardingTrainingSession";
import { AssessmentRunner } from "./AssessmentRunner";
import { PolicyAcknowledgment } from "./PolicyAcknowledgment";
import { assessmentQuestionsFor, policyDocumentFor } from "./content";
import { getTrainingAdapter } from "./training/registry";
import { supportsEmbeddedTraining } from "./catalog";
import { sharedCompletionKey } from "./requirementIdentity";
import {
  roleOrientationState,
  sanitizeOnboardingReturnPath,
} from "./orientationGate";
import type {
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
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const lockLabel = (reason: string) =>
  reason === "retraining_required"
    ? "Retraining required"
    : reason === "expired_certification"
      ? "Certification expired"
      : "Certification required";

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
}: {
  audience?: "internal" | "vendor";
}) {
  const { profile } = useSession();
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
  const returnPath = sanitizeOnboardingReturnPath(searchParams.get("next"));
  const requiredHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const trainingWasActive = useRef(false);
  const focusedRequirementRef = useRef<string | null>(null);

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
      requiredHeadingRef.current?.focus();
    });
  }, [activeTraining]);

  const view = useMemo(() => {
    const requirements = new Map<string, RequirementDefinition>();
    const allRequirements = new Map<string, RequirementDefinition>();
    const sharedRequirements = new Set<string>();
    const personaIds = new Set<string>();
    for (const effective of snapshot?.curricula ?? []) {
      if (effective.curriculum.audience !== audience) continue;
      personaIds.add(effective.curriculum.personaId);
      for (const requirement of effective.requirements) {
        allRequirements.set(requirement.id, requirement);
        const sharedKey = sharedCompletionKey(requirement);
        if (sharedRequirements.has(sharedKey)) continue;
        sharedRequirements.add(sharedKey);
        requirements.set(requirement.id, requirement);
      }
    }
    const progress = new Map(
      (snapshot?.progress ?? []).map((item) => [item.requirementId, item]),
    );
    const completedSharedKeys = new Set(
      [...progress.values()].flatMap((item) => {
        if (!["passed", "waived"].includes(item.state)) return [];
        const requirement = allRequirements.get(item.requirementId);
        return requirement ? [sharedCompletionKey(requirement)] : [];
      }),
    );
    const required = [...requirements.values()].filter(
      (item) => item.mandatory,
    );
    const completed = required.filter((item) =>
      ["passed", "waived"].includes(progress.get(item.id)?.state ?? ""),
    ).length;
    const personas = OPERATING_PERSONAS.filter((item) =>
      personaIds.has(item.id),
    );
    const ordered = [...requirements.values()].sort((left, right) => {
      const rank = (item: RequirementDefinition) => {
        const state = progress.get(item.id)?.state ?? "not_started";
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
      personas,
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

  if (!snapshot && error) {
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
        <p className="mt-2 text-sm text-muted">{error}</p>
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

  if (!snapshot || view.requirements.length === 0) {
    return (
      <div className="mx-auto max-w-2xl border-y border-line py-10 text-center">
        <Icon name="clipboard" className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">
          No onboarding assigned yet
        </h1>
        <p className="mt-2 text-sm text-muted">
          You can continue exploring read-only areas while your role curriculum
          is assigned.
        </p>
        <Link href="/knowledge" className="btn-outline mt-6 inline-flex">
          Open Knowledge Base
        </Link>
      </div>
    );
  }

  const unavailableReasonFor = (requirement: RequirementDefinition) => {
    const state = view.progress.get(requirement.id)?.state;
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
      const prerequisiteState = view.progress.get(requirementId)?.state;
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
    const state = view.progress.get(requirement.id)?.state ?? "not_started";
    return (
      !["passed", "waived", "needs_support", "expired"].includes(state) &&
      !unavailableReasonFor(requirement)
    );
  });
  const orientation = roleOrientationState(snapshot);
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
    ? view.progress.get(activeActivity.requirementId)
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
        className="border-b border-line pb-5"
        data-onboarding-anchor="onboarding-role-context"
      >
        <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
          {audience === "vendor"
            ? "Accreditation and access"
            : "Learning and access"}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
          {audience === "vendor" ? "Vendor onboarding" : "Role onboarding"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Practice the work your role performs. Live actions unlock only after
          the required controls are complete.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {view.personas.map((persona) => (
            <Badge key={persona.id} tone="brand">
              {persona.label}
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

      <section className="border-b border-line py-5">
        <OnboardingProgress
          completed={view.completed}
          total={view.required.length}
        />
        {audience === "internal" && returnPath && orientation.complete && (
          <div className="mt-5 flex flex-col gap-3 border-l-4 border-emerald-500 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                Role orientation complete
              </p>
              <p className="mt-1 font-display text-base font-bold text-ink">
                {returnLabel} is ready
              </p>
              <p className="mt-1 text-sm text-muted">
                You may enter the module now. Remaining learning continues to
                govern its specific live actions.
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
        {next && (
          <div className="mt-5 flex flex-col gap-3 border-l-4 border-brand-500 bg-brand-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                Next required action
              </p>
              <p className="mt-1 font-display text-base font-bold text-ink">
                {next.title}
              </p>
              <p className="mt-1 text-sm text-muted">
                {KIND_LABEL[next.kind]} |{" "}
                {next.mandatory ? "Required" : "Optional"}
              </p>
            </div>
            <RequirementAction
              requirement={next}
              progress={view.progress.get(next.id)}
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

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          className="py-6 lg:pr-8"
          aria-labelledby="required-learning-heading"
          data-onboarding-anchor="onboarding-required-steps"
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
              Complete these in order. Shared requirements appear once.
            </p>
          </div>
          <ol className="border-t border-line">
            {view.requirements.map((requirement, index) => {
              const progress = view.progress.get(requirement.id);
              return (
                <li
                  key={requirement.id}
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
                    <p className="mt-1 text-sm text-muted">
                      {KIND_LABEL[requirement.kind]}
                      {requirement.maxAttempts
                        ? ` | ${progress?.attemptCount ?? 0} of ${requirement.maxAttempts} attempts used`
                        : ""}
                    </p>
                  </div>
                  {requirement.id === next?.id ? (
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
          aria-label="Access outcomes"
        >
          <section>
            <h2 className="font-display text-base font-bold text-ink">
              Access outcomes
            </h2>
            {snapshot.lockedCapabilities.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {snapshot.lockedCapabilities.map((lock) => (
                  <li
                    key={`${lock.capability.module}:${lock.capability.capability}`}
                    className="border-l-2 border-amber-500 pl-3"
                  >
                    <p className="font-semibold text-ink">
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
                No capabilities are waiting on onboarding.
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
    </div>
  );
}
