export function projectRefFromSupabaseUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function assertApprovedMutationTarget({
  supabaseUrl,
  expectedProjectRef,
  productionProjectRef,
  mutationsRequested,
  mutationsApproved,
}) {
  const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (!projectRef) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase project URL.",
    );
  }
  if (!expectedProjectRef || projectRef !== expectedProjectRef) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL project ref does not match SUPABASE_PROJECT_REF.",
    );
  }
  if (!mutationsRequested) return;
  if (!productionProjectRef) {
    throw new Error(
      "PRODUCTION_SUPABASE_PROJECT_REF is required for mutation runs.",
    );
  }
  if (projectRef === productionProjectRef) {
    throw new Error(
      "Mutations against the production Supabase project are forbidden.",
    );
  }
  if (!mutationsApproved) {
    throw new Error(
      "Mutation runs require POLICY_ALLOW_TEST_MUTATIONS=true.",
    );
  }
}
