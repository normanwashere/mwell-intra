// Run the live route matrix with onboarding redirects, recovery states, and
// effective capability expectations enabled. The shared harness owns login,
// evidence capture, and fail-closed environment validation.
process.env.AUDIT_PHASE = "routes";
process.env.AUDIT_MUTATIONS = "false";
process.env.AUDIT_OUTPUT_PATH ??= "test-results/onboarding-live.json";

await import("./full-intra-live-e2e.mjs");
