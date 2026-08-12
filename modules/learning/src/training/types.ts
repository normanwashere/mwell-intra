export interface TrainingCommand<TPayload = unknown> {
  type: string;
  payload?: TPayload;
}

export interface TrainingTransition<TState> {
  state: TState;
  nextStepId: string;
  checkpointId?: string;
  outcomeId?: string;
  completed?: boolean;
}

export interface TrainingAdapter<TState> {
  id: string;
  version: number;
  scenarioIds: readonly string[];
  route?: string;
  initialState(scenarioId: string): TState;
  dispatch(
    state: Readonly<TState>,
    command: TrainingCommand,
  ): TrainingTransition<TState>;
}

export interface TrainingStep {
  id: string;
  title: string;
  instruction: string;
  anchor: string;
  allowedCommands: readonly string[];
  terminal?: boolean;
}

export interface TrainingScenario {
  id: string;
  title: string;
  initialStepId: string;
  steps: readonly TrainingStep[];
}

export interface TrainingCheckpoint {
  assignmentRequirementId: string;
  attemptId: string;
  scenarioId: string;
  checkpointId: string;
  outcomeId?: string;
  idempotencyKey: string;
  terminal?: boolean;
}

export type TrainingPlacement = "right" | "left" | "bottom" | "top" | "sheet";
