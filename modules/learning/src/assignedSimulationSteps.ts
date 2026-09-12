import type { SimulationDefinition, SimulationStepDefinition } from "./types";

export function assignedSimulationSteps(
  simulation: SimulationDefinition,
  requiredCheckpointIds: readonly string[] | undefined,
): readonly SimulationStepDefinition[] {
  if (
    !requiredCheckpointIds?.length ||
    new Set(requiredCheckpointIds).size !== requiredCheckpointIds.length
  ) {
    throw new Error(
      "Your assigned training steps could not be loaded. Close this practice and refresh the page. If it happens again, contact your administrator.",
    );
  }
  return requiredCheckpointIds.map((id) => {
    const step = simulation.embeddedSteps?.find(
      (candidate) => candidate.checkpointId === id,
    );
    if (!step) {
      throw new Error(
        "This training version is not available in this app yet. Close this practice and contact your administrator. Your training has not been marked complete.",
      );
    }
    return step;
  });
}
