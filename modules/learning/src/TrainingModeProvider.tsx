"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  TrainingAdapter,
  TrainingCheckpoint,
  TrainingCommand,
  TrainingScenario,
  TrainingStep,
} from "./training/types";
import { createIdempotencyKey } from "./training/idempotency";

const clone = <T,>(value: T): T => structuredClone(value);

interface HistoryEntry<TState> {
  state: TState;
  stepId: string;
  reversible: boolean;
}

export interface TrainingContextValue<TState = unknown> {
  active: boolean;
  completed: boolean;
  checkpointError: string | null;
  busy: boolean;
  state: TState;
  scenario: TrainingScenario;
  currentStep: TrainingStep;
  canGoBack: boolean;
  dispatch(command: TrainingCommand): Promise<void>;
  back(): void;
  reset(): void;
  exit(): void;
  resumeLater(): void;
  resume(): void;
}

const TrainingContext = createContext<TrainingContextValue | null>(null);

export function TrainingModeProvider<TState>({
  adapter,
  scenario,
  assignmentRequirementId,
  attemptId,
  onCheckpoint,
  launcherRef,
  initiallyActive = true,
  children,
}: {
  adapter: TrainingAdapter<TState>;
  scenario: TrainingScenario;
  assignmentRequirementId: string;
  attemptId: string;
  onCheckpoint(event: TrainingCheckpoint): Promise<void>;
  launcherRef?: RefObject<HTMLElement | null>;
  initiallyActive?: boolean;
  children: ReactNode;
}) {
  if (!adapter.scenarioIds.includes(scenario.id)) {
    throw new Error(`Training adapter ${adapter.id} does not support ${scenario.id}.`);
  }
  const stepById = useMemo(
    () => new Map(scenario.steps.map((step) => [step.id, step])),
    [scenario.steps],
  );
  if (!stepById.has(scenario.initialStepId)) {
    throw new Error(`Training scenario ${scenario.id} has no initial step.`);
  }

  const initialState = useCallback(
    () => clone(adapter.initialState(scenario.id)),
    [adapter, scenario.id],
  );
  const [state, setState] = useState<TState>(initialState);
  const [stepId, setStepId] = useState(scenario.initialStepId);
  const [active, setActive] = useState(initiallyActive);
  const [completed, setCompleted] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<readonly HistoryEntry<TState>[]>([]);
  const reportedCheckpoints = useRef(new Set<string>());
  const checkpointKeys = useRef(new Map<string, string>());
  const dispatchInFlight = useRef(false);
  const currentStep = stepById.get(stepId);
  if (!currentStep) throw new Error(`Training scenario ${scenario.id} has no step ${stepId}.`);

  const dispatch = useCallback(
    async (command: TrainingCommand) => {
      if (dispatchInFlight.current) {
        throw new Error("A training command is already in progress.");
      }
      if (!currentStep.allowedCommands.includes(command.type)) {
        throw new Error(
          `Command ${command.type} is not allowed for training step ${currentStep.id}.`,
        );
      }
      dispatchInFlight.current = true;
      setBusy(true);
      try {
        const transition = adapter.dispatch(clone(state), command);
        if (!stepById.has(transition.nextStepId)) {
          throw new Error(
            `Training adapter ${adapter.id} returned unknown step ${transition.nextStepId}.`,
          );
        }
        if (transition.checkpointId) {
          const checkpointIdentity = `${attemptId}:${transition.checkpointId}`;
          if (!reportedCheckpoints.current.has(checkpointIdentity)) {
            const idempotencyKey =
              checkpointKeys.current.get(checkpointIdentity) ?? createIdempotencyKey();
            checkpointKeys.current.set(checkpointIdentity, idempotencyKey);
            await onCheckpoint({
              assignmentRequirementId,
              attemptId,
              scenarioId: scenario.id,
              checkpointId: transition.checkpointId,
              outcomeId: transition.outcomeId,
              idempotencyKey,
              terminal: Boolean(transition.completed),
            });
            reportedCheckpoints.current.add(checkpointIdentity);
            setCheckpointError(null);
          }
        }
        setHistory((entries) => [
          ...entries,
          {
            state: clone(state),
            stepId,
            reversible: !transition.checkpointId,
          },
        ]);
        setState(clone(transition.state));
        setStepId(transition.nextStepId);
        setCompleted(Boolean(transition.completed));
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Training progress could not be saved.";
        setCheckpointError(message);
        throw cause;
      } finally {
        dispatchInFlight.current = false;
        setBusy(false);
      }
    }, [adapter, assignmentRequirementId, attemptId, currentStep, onCheckpoint, scenario.id, state, stepById, stepId],
  );

  const reset = useCallback(() => {
    setState(initialState());
    setStepId(scenario.initialStepId);
    setHistory([]);
    setCompleted(false);
    setCheckpointError(null);
  }, [initialState, scenario.initialStepId]);

  const focusLauncher = useCallback(() => {
    launcherRef?.current?.focus();
  }, [launcherRef]);

  const value = useMemo<TrainingContextValue<TState>>(
    () => ({
      active,
      completed,
      checkpointError,
      busy,
      state,
      scenario,
      currentStep,
      canGoBack: history.at(-1)?.reversible === true,
      dispatch,
      back() {
        const previous = history.at(-1);
        if (!previous?.reversible) return;
        setState(clone(previous.state));
        setStepId(previous.stepId);
        setHistory((entries) => entries.slice(0, -1));
        setCompleted(false);
      },
      reset,
      exit() {
        reset();
        setActive(false);
        focusLauncher();
      },
      resumeLater() {
        setActive(false);
        focusLauncher();
      },
      resume() {
        setActive(true);
      },
    }),
    [active, busy, checkpointError, completed, currentStep, dispatch, focusLauncher, history, reset, scenario, state],
  );

  return (
    <TrainingContext.Provider value={value as TrainingContextValue}>
      {children}
    </TrainingContext.Provider>
  );
}

export function useTraining<TState = unknown>(): TrainingContextValue<TState> {
  const value = useContext(TrainingContext);
  if (!value) throw new Error("useTraining must be used within TrainingModeProvider.");
  return value as TrainingContextValue<TState>;
}
