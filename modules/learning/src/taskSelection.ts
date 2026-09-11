import { sanitizeOnboardingReturnPath } from './orientationGate';
import type { LearningCapability, LearningSnapshot } from './types';

export function taskRequirementIds(snapshot: LearningSnapshot | null, audience: 'internal' | 'vendor', capabilities: readonly LearningCapability[]): string[] {
  if (!snapshot) return [];
  const requirements = snapshot.curricula.filter(item => item.curriculum.audience === audience)
    .flatMap(item => item.requirements).filter(item => item.audience === audience);
  const matches = (cap: LearningCapability) => capabilities.some(item => item.module === cap.module && item.capability === cap.capability);
  const roots = requirements.filter(item => item.capabilityOutcomes.some(matches)).map(item => item.id);
  roots.push(...snapshot.lockedCapabilities.filter(lock => matches(lock.capability)).flatMap(lock => lock.requirementIds));
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const requirement = requirements.find(item => item.id === id);
    if (!requirement) return;
    visited.add(id);
    requirement.prerequisiteIds.forEach(visit);
  };
  roots.forEach(visit);
  return [...visited];
}

/** Only preserves a return within the selected task's workspace; it never grants access. */
export function taskSelectionQuery(
  current: URLSearchParams,
  task: { id: string; actionHref: string },
  compatibleRequirementIds: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  const action = sanitizeOnboardingReturnPath(task.actionHref) ?? '/work';
  const origin = sanitizeOnboardingReturnPath(current.get('next'));
  const workspace = new URL(action, 'https://intra.invalid').pathname.split('/')[1];
  const compatible = origin && new URL(origin, 'https://intra.invalid').pathname.split('/')[1] === workspace;
  next.set('task', task.id);
  next.set('next', compatible ? origin : action);
  if (!compatibleRequirementIds.includes(next.get('requirement') ?? '')) next.delete('requirement');
  return next;
}
