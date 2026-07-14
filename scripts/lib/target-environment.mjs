export function projectRefFromSupabaseUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isCanonicalProjectRef(value) {
  return typeof value === "string" && /^[a-z0-9]+$/.test(value);
}

export function assertApprovedMutationTarget({
  appEnv,
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
  if (!isCanonicalProjectRef(expectedProjectRef)) {
    throw new Error(
      "SUPABASE_PROJECT_REF must be a canonical project ref using lowercase letters and numbers only.",
    );
  }
  if (
    productionProjectRef != null &&
    productionProjectRef !== "" &&
    !isCanonicalProjectRef(productionProjectRef)
  ) {
    throw new Error(
      "PRODUCTION_SUPABASE_PROJECT_REF must be a canonical project ref using lowercase letters and numbers only.",
    );
  }
  if (projectRef !== expectedProjectRef) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL project ref does not match SUPABASE_PROJECT_REF.",
    );
  }
  if (!mutationsRequested) return;
  if (appEnv === "production") {
    throw new Error("Mutation runs are forbidden when APP_ENV=production.");
  }
  if (appEnv !== "uat" && appEnv !== "local") {
    throw new Error("APP_ENV must be uat or local for mutation runs.");
  }
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

export async function verifyDeployedTargetIdentity({
  baseUrl,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  mutationsRequested,
  protectionBypass,
  fetchImpl = fetch,
}) {
  const headers = new Headers();
  if (protectionBypass) {
    headers.set("x-vercel-protection-bypass", protectionBypass);
  }

  let response;
  try {
    response = await fetchImpl(new URL("/api/health", `${baseUrl}/`), {
      cache: "no-store",
      headers,
    });
  } catch {
    throw new Error(
      "Unable to read deployed target identity from AUDIT_BASE_URL/api/health.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `AUDIT_BASE_URL/api/health returned HTTP ${response.status}; deployed target identity was not verified.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "AUDIT_BASE_URL/api/health did not return a valid deployed target identity.",
    );
  }
  const deployment = payload?.deployment;
  if (
    typeof deployment?.appEnv !== "string" ||
    !isCanonicalProjectRef(deployment?.supabaseProjectRef)
  ) {
    throw new Error(
      "AUDIT_BASE_URL/api/health did not return a valid deployed target identity.",
    );
  }
  if (deployment.appEnv !== appEnv) {
    throw new Error(
      "Deployed APP_ENV does not match the runner APP_ENV.",
    );
  }
  if (deployment.supabaseProjectRef !== expectedProjectRef) {
    throw new Error(
      "Deployed Supabase project ref does not match SUPABASE_PROJECT_REF.",
    );
  }
  if (
    mutationsRequested &&
    (deployment.appEnv === "production" ||
      deployment.supabaseProjectRef === productionProjectRef)
  ) {
    throw new Error(
      "Mutations against the deployed production target are forbidden.",
    );
  }
}
