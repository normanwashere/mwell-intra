export function mergeStageEvidenceManifest(existing, replacements, metadata) {
  const replacementByBinding = new Map();
  for (const replacement of replacements) {
    if (!replacement?.bindingId || replacementByBinding.has(replacement.bindingId)) {
      throw new Error("Targeted handbook evidence contains a missing or duplicate binding.");
    }
    replacementByBinding.set(replacement.bindingId, replacement);
  }
  const knownBindings = new Set((existing.stages ?? []).map(({ bindingId }) => bindingId));
  for (const bindingId of replacementByBinding.keys()) {
    if (!knownBindings.has(bindingId)) {
      throw new Error(`Targeted handbook evidence references unknown binding ${bindingId}.`);
    }
  }
  return {
    ...existing,
    ...metadata,
    stages: (existing.stages ?? []).map((stage) =>
      replacementByBinding.get(stage.bindingId) ?? stage
    ),
  };
}
