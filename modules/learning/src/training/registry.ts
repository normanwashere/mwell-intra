import type { TrainingAdapter } from "./types";

const adapters = new Map<string, TrainingAdapter<unknown>>();

export function registerTrainingAdapter<TState>(
  adapter: TrainingAdapter<TState>,
): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Training adapter ${adapter.id} is already registered.`);
  }
  adapters.set(adapter.id, adapter as TrainingAdapter<unknown>);
}

export function getTrainingAdapter(
  id: string,
): TrainingAdapter<unknown> | undefined {
  return adapters.get(id);
}

export function clearTrainingAdaptersForTests(): void {
  adapters.clear();
}
