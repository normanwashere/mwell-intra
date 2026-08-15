"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CoachOverlay } from "./CoachOverlay";
import { TrainingBanner } from "./TrainingBanner";
import { TrainingModeProvider, useTraining } from "./TrainingModeProvider";
import type { TrainingAdapter, TrainingScenario } from "./training/types";
import { createIdempotencyKey } from "./training/idempotency";
import { LEARNING_CATALOG } from "./catalog";
import type {
  SimulationChoiceEvaluation,
  SimulationChoiceSubmission,
} from "./types";
import "./training.css";

interface PreparationState {
  stepIndex: number;
}

function Runtime({
  assignmentRequirementId,
  attemptId,
  scenarioId,
  onEvaluateChoice,
  onClose,
}: {
  assignmentRequirementId: string;
  attemptId: string;
  scenarioId: string;
  onEvaluateChoice(
    input: SimulationChoiceSubmission,
  ): Promise<SimulationChoiceEvaluation>;
  onClose(): void;
}) {
  const training = useTraining<PreparationState>();
  const command = training.currentStep.allowedCommands[0] ?? null;
  const [choiceFeedback, setChoiceFeedback] = useState<string | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const evaluationKeys = useRef(new Map<string, string>());

  useEffect(() => {
    setChoiceFeedback(null);
    setSelectedChoiceId(null);
    setEvaluationError(null);
  }, [training.currentStep.id]);

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
            training.currentStep.terminal
              ? () => {
                  training.exit();
                  onClose();
                }
              : command
                ? () => {
                    void training
                      .dispatch({ type: command })
                      .catch(() => undefined);
                  }
                : undefined
          }
          onChoose={(choice) => {
            setSelectedChoiceId(choice.id);
            setChoiceFeedback(null);
            setEvaluationError(null);
            if (!command || evaluating) return;
            const identity = `${attemptId}:${training.currentStep.id}:${choice.id}`;
            const idempotencyKey =
              evaluationKeys.current.get(identity) ?? createIdempotencyKey();
            evaluationKeys.current.set(identity, idempotencyKey);
            setEvaluating(true);
            void onEvaluateChoice({
              assignmentRequirementId,
              attemptId,
              simulationId: scenarioId,
              checkpointId: training.currentStep.id,
              choiceId: choice.id,
              idempotencyKey,
            })
              .then((result) => {
                if (!result.accepted) {
                  setChoiceFeedback(result.feedback);
                  return;
                }
                setChoiceFeedback(null);
                return training.dispatch({
                  type: command,
                  checkpointAlreadyRecorded: true,
                });
              })
              .catch((cause: unknown) => {
                setEvaluationError(
                  cause instanceof Error
                    ? cause.message
                    : "This choice could not be checked.",
                );
              })
              .finally(() => setEvaluating(false));
          }}
          selectedChoiceId={selectedChoiceId}
          choiceFeedback={choiceFeedback}
          continueLabel={
            training.currentStep.terminal ? "Finish review" : "Continue"
          }
          continueDisabled={training.busy || evaluating}
          error={evaluationError ?? training.checkpointError}
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
  onEvaluateChoice,
  onClose,
}: {
  requirementTitle: string;
  assignmentRequirementId: string;
  attemptId: string;
  scenarioId: string;
  launcherRef: RefObject<HTMLElement | null>;
  onCheckpoint: Parameters<typeof TrainingModeProvider>[0]["onCheckpoint"];
  onEvaluateChoice(
    input: SimulationChoiceSubmission,
  ): Promise<SimulationChoiceEvaluation>;
  onClose(): void;
}) {
  const publishedSimulation = LEARNING_CATALOG.simulations.find(
    (simulation) => simulation.id === scenarioId,
  );
  const scenario = useMemo<TrainingScenario>(() => {
    const embeddedSteps = publishedSimulation?.embeddedSteps;
    if (embeddedSteps?.length) {
      return {
        id: scenarioId,
        title: requirementTitle,
        initialStepId: embeddedSteps[0]!.checkpointId,
        steps: [
          ...embeddedSteps.map((step) => ({
            id: step.checkpointId,
            title: step.title,
            instruction: step.instruction,
            context: step.context,
            question: step.question,
            choices: step.choices,
            anchor: "[data-onboarding-anchor='onboarding-required-steps']",
            allowedCommands: [`confirm:${step.checkpointId}`],
          })),
          {
            id: "reviewed",
            title: "Guided practice complete",
            instruction:
              "The practice checkpoints are recorded. Live work remains subject to current authority and source-record controls.",
            anchor: "[data-onboarding-anchor='onboarding-required-steps']",
            allowedCommands: [],
            terminal: true,
          },
        ],
      };
    }
    return {
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
    };
  }, [publishedSimulation, requirementTitle, scenarioId]);
  const adapter = useMemo<TrainingAdapter<PreparationState>>(
    () => ({
      id: `preparation:${scenarioId}`,
      version: 1,
      scenarioIds: [scenario.id],
      initialState: () => ({ stepIndex: 0 }),
      dispatch(state, command) {
        const embeddedSteps = publishedSimulation?.embeddedSteps;
        if (embeddedSteps?.length) {
          const step = embeddedSteps[state.stepIndex];
          if (!step || command.type !== `confirm:${step.checkpointId}`) {
            throw new Error(
              `Unknown governed practice command ${command.type}.`,
            );
          }
          const nextIndex = state.stepIndex + 1;
          return {
            state: { stepIndex: nextIndex },
            nextStepId:
              nextIndex < embeddedSteps.length
                ? embeddedSteps[nextIndex]!.checkpointId
                : "reviewed",
            checkpointId: step.checkpointId,
            outcomeId: step.outcomeId,
            completed: nextIndex === embeddedSteps.length,
          };
        }
        if (command.type === "review-role-context" && state.stepIndex === 0) {
          return { state: { stepIndex: 1 }, nextStepId: "required-step" };
        }
        if (command.type === "review-required-step" && state.stepIndex === 1) {
          return {
            state: { stepIndex: 2 },
            nextStepId: "reviewed",
            checkpointId: "complete",
            outcomeId: "reviewed",
            completed: true,
          };
        }
        throw new Error(
          `Unknown onboarding preparation command ${command.type}.`,
        );
      },
    }),
    [publishedSimulation, scenario.id, scenarioId],
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
      <Runtime
        assignmentRequirementId={assignmentRequirementId}
        attemptId={attemptId}
        scenarioId={scenarioId}
        onEvaluateChoice={onEvaluateChoice}
        onClose={onClose}
      />
    </TrainingModeProvider>
  );
}
