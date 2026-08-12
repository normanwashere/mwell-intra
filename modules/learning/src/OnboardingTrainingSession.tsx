"use client";

import { useMemo, type RefObject } from "react";
import { CoachOverlay } from "./CoachOverlay";
import { TrainingBanner } from "./TrainingBanner";
import {
  TrainingModeProvider,
  useTraining,
} from "./TrainingModeProvider";
import type {
  TrainingAdapter,
  TrainingScenario,
} from "./training/types";
import "./training.css";

interface PreparationState {
  reviewedRoleContext: boolean;
  reviewedRequirement: boolean;
}

function Runtime({ onClose }: { onClose(): void }) {
  const training = useTraining<PreparationState>();
  const command =
    training.currentStep.id === "role-context"
      ? "review-role-context"
      : training.currentStep.id === "required-step"
        ? "review-required-step"
        : null;

  return (
    <>
      <TrainingBanner
        onExit={() => {
          training.exit();
          onClose();
        }}
      />
      {training.active && (
        <CoachOverlay
          step={training.currentStep}
          canGoBack={training.canGoBack}
          onBack={training.back}
          onResumeLater={training.resumeLater}
          onExit={() => {
            training.exit();
            onClose();
          }}
          onContinue={
            command
              ? () => {
                  void training.dispatch({ type: command }).catch(() => undefined);
                }
              : undefined
          }
          continueLabel={command === "review-required-step" ? "Finish review" : "Continue"}
          continueDisabled={training.busy}
          error={training.checkpointError}
        />
      )}
    </>
  );
}

export function OnboardingTrainingSession({
  requirementTitle,
  assignmentRequirementId,
  attemptId,
  scenarioId,
  launcherRef,
  onCheckpoint,
  onClose,
}: {
  requirementTitle: string;
  assignmentRequirementId: string;
  attemptId: string;
  scenarioId: string;
  launcherRef: RefObject<HTMLElement | null>;
  onCheckpoint: Parameters<typeof TrainingModeProvider>[0]["onCheckpoint"];
  onClose(): void;
}) {
  const scenario = useMemo<TrainingScenario>(
    () => ({
      id: scenarioId,
      title: requirementTitle,
      initialStepId: "role-context",
      steps: [
        {
          id: "role-context",
          title: "Confirm why this step is assigned",
          instruction:
            "Review the role badges and access explanation before practicing the task.",
          anchor: "[data-onboarding-anchor='onboarding-role-context']",
          allowedCommands: ["review-role-context"],
        },
        {
          id: "required-step",
          title: requirementTitle,
          instruction:
            "Review this requirement, its current status, and the action that follows it.",
          anchor: "[data-onboarding-anchor='onboarding-required-steps']",
          allowedCommands: ["review-required-step"],
        },
        {
          id: "reviewed",
          title: "Guided review complete",
          instruction:
            "You can exit this review now. Scenario practice and evidence remain separate from live transactions.",
          anchor: "[data-onboarding-anchor='onboarding-required-steps']",
          allowedCommands: [],
          terminal: true,
        },
      ],
    }),
    [requirementTitle, scenarioId],
  );
  const adapter = useMemo<TrainingAdapter<PreparationState>>(
    () => ({
      id: `preparation:${scenarioId}`,
      version: 1,
      scenarioIds: [scenario.id],
      initialState: () => ({
        reviewedRoleContext: false,
        reviewedRequirement: false,
      }),
      dispatch(state, command) {
        if (command.type === "review-role-context") {
          return {
            state: { ...state, reviewedRoleContext: true },
            nextStepId: "required-step",
          };
        }
        if (command.type === "review-required-step") {
          return {
            state: { ...state, reviewedRequirement: true },
            nextStepId: "reviewed",
            checkpointId: "complete",
            outcomeId: "reviewed",
            completed: true,
          };
        }
        throw new Error(`Unknown onboarding preparation command ${command.type}.`);
      },
    }),
    [scenario.id, scenarioId],
  );

  return (
    <TrainingModeProvider
      key={attemptId}
      adapter={adapter}
      scenario={scenario}
      assignmentRequirementId={assignmentRequirementId}
      attemptId={attemptId}
      onCheckpoint={onCheckpoint}
      launcherRef={launcherRef}
    >
      <Runtime onClose={onClose} />
    </TrainingModeProvider>
  );
}
