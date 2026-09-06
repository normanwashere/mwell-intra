const destructive = new Set([
  "Revoke role", "Deactivate department", "Remove tier", "Reset draft", "Cancel reservation",
  "Split backorder or cancel", "Cancel order", "Reject stock", "Reject change", "Deactivate location",
  "Delete draft route", "Cancel request", "Reject request", "Reject case", "Discard draft", "Replace evidence",
]);
const identity = new Set([
  "Sign in", "Send reset link", "Use demo profile", "Update password", "Sign out", "Sign out vendor",
  "Assign role", "Activate matrix", "Send invitation",
]);
const external = new Set([
  "Export governed snapshot", "Export inventory", "Export movements", "Export current view", "Print barcode sheet",
  "Export planning view", "Export allocations", "Export inventory position", "Export quality", "Export cycle counts",
  "Export CSV", "Download errors", "Open attachment", "Upload evidence", "Capture evidence", "Capture return evidence",
  "Choose file", "Start scanner", "Enter signature", "Confirm signature",
]);
// Exact documented names only. This list is triage, never permission to invoke a control.
const navigation = new Set([
  "Open module", "Use primary navigation", "View account details", "Back to sign in", "Search handbook",
  "Filter role", "Filter module", "Filter content type", "Open contextual guidance", "Open support guidance",
  "Return to vendor portal", "Source filter", "Open source", "View event", "Open Warehouse fulfillment",
  "Insight view", "Open governed source", "Track follow-ups in My Work", "Open users", "Open authority",
  "Open runbook", "Open profile", "Search evidence", "Filter action", "Open technical details",
  "Open primary task", "Open product alert", "Open event", "Open export menu", "Show due tasks",
  "Show blocked tasks", "Open task", "Search inventory", "Filter stock state", "Open product",
  "Back to inventory", "Open traceability", "Open financial context", "Filter events", "Back to events",
  "Filter stock risk", "Open product plan", "Review inbound supply", "Filter orders", "Open order",
  "Show variances only", "Open inspection", "Open approval", "Close decision", "Filter exceptions",
  "Clear filters", "Open exception", "Open evidence", "Review next payment pack", "Filter cross-module activity",
  "Open source record", "Filter products", "Open price editor", "Select report", "Apply report filters",
  "Clear report", "Search suppliers", "Filter accreditation", "Open supplier", "Preview rows", "Filter status",
  "Open request", "Back to requests", "Open decision", "Open purchase order", "Filter case status",
  "Clear case filter", "Open case", "Open application", "Open checklist item", "Back to case", "Review section",
  "Back to legal case", "Review signed record", "Back to cases", "Open own case", "Open instrument", "Return to own case",
]);
const retry = new Set(["Retry", "Refresh status", "Retry quality queue", "Retry unavailable sources"]);
const approvedRoutine = new Set([
  "knowledge-library:Search handbook", "knowledge-library:Filter role", "knowledge-library:Filter module",
  "knowledge-library:Filter content type", "shell-home:Open module", "shell-home:Use primary navigation",
  "vendor-onboarding:Return to vendor portal",
]);

export function planControl(row) {
  const routineApproved = approvedRoutine.has(row.id ?? row.key);
  const classification = destructive.has(row.control) ? "destructive-prohibited"
    : identity.has(row.control) ? "identity-or-authority-main-only"
      : external.has(row.control) ? "external-io-or-sensitive-prohibited"
        : navigation.has(row.control) ? "navigation-or-local-view-review-required"
          : retry.has(row.control) ? "read-recovery-needs-fault-fixture"
            : "write-or-unresolved-prohibited";
  return {
    classification,
    classificationBasis: "Exact documented name triage, not proof of handler effects. Unknown actions are prohibited by default.",
    eligibleRoleIds: row.roleIds,
    requiredCapabilityIds: row.capabilityIds,
    assignedActorRoleId: null,
    fixtureRequired: !routineApproved,
    routineUiApproval: routineApproved ? "main-approved-empty-search-or-read-only-navigation; no separate business-owner fixture required" : null,
    fixtureReason: routineApproved ? "Use an empty/non-sensitive UI state under main's approval; resolve exact source target and authorized route before interaction. Approval does not assert the control exists in this layout."
      : retry.has(row.control)
      ? "Requires an approved failed-read state; no arbitrary failure injection or replay."
      : "Owner must provide an authorized route/state with the exact control visible; empty/loaded state must be confirmed even for navigation.",
    allowedNow: ["inspect-source", "prepare-target-binding", "review-existing-artifact-with-provenance"],
    allowedAfterCandidateApproval: ["observe-owner-prepared-state", "scroll-within-prepared-page", "capture-visible-control-without-activation"],
    activationAllowed: false,
    stateCapture: "Capture the exact existing prerequisite/disabled/decision state without submitting, changing evidence, downloading, acknowledging, reconnecting queued work or altering business state.",
    transitionEvidence: "unexercised-separate-authorization-required",
    targetBinding: { route: null, role: null, accessibleName: null, selector: null, state: null, sourceReference: null },
  };
}

const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const date = (value) => nonblank(value) && Number.isFinite(Date.parse(value));
function matchesRoute(template, actual) {
  if (!nonblank(template) || !nonblank(actual) || !actual.startsWith("/") || actual.startsWith("//")) return false;
  const expected = template.replace(/\/$/, "").split("/");
  const parts = actual.split(/[?#]/)[0].replace(/\/$/, "").split("/");
  return expected.length === parts.length && expected.every((part, index) =>
    part.startsWith(":") ? Boolean(parts[index]) : part === parts[index]);
}

export function evaluateControlReview(row, run) {
  const errors = [];
  if (!sha(run.candidateCommit) || run.candidateCommit.startsWith("7083373")) errors.push("candidate-sha-required-not-baseline");
  if (run.healthCommit !== run.candidateCommit || !date(run.healthVerifiedAt)) errors.push("exact-candidate-health-required");
  if (run.controlId !== row.id) errors.push("exact-control-id-required");
  if (!row.roleIds.includes(run.actorRoleId)) errors.push("eligible-role-required");
  if (run.authorizationConfirmed !== true || run.noBusinessWrites !== true) errors.push("read-only-authorized-scope-required");
  if (!nonblank(run.fixtureReference) || !nonblank(run.state)) errors.push("approved-fixture-and-state-required");
  if (!row.routes.includes(run.routeTemplate) || !matchesRoute(run.routeTemplate, run.actualRoute)) errors.push("exact-route-binding-required");
  if (!Array.isArray(run.attempts) || !run.attempts.length) return { status: errors.length ? "blocked" : "notcaptured", errors };
  for (const viewport of ["desktop", "mobile"]) {
    const attempts = run.attempts.filter((attempt) => attempt.viewport === viewport);
    // Preserve earlier failures. The selected attempt must be explicit and unique per viewport.
    const selected = attempts.filter((attempt) => attempt.selected === true);
    if (selected.length !== 1) { errors.push(`${viewport}:one-selected-attempt-required`); continue; }
    const attempt = selected[0];
    if (!nonblank(attempt.path) || !hash(attempt.sha256) || !date(attempt.capturedAt) ||
      !nonblank(attempt.capturedBy) || attempt.commit !== run.candidateCommit) errors.push(`${viewport}:capture-provenance-required`);
    if (!(attempt.width > 0 && attempt.height > 0) || !nonblank(attempt.locator) || attempt.matchCount !== 1 ||
      attempt.targetVisible !== true || attempt.targetMasked !== false || attempt.exactStateConfirmed !== true)
      errors.push(`${viewport}:unique-visible-unmasked-exact-target-required`);
    if (attempt.businessWritesObserved !== false) errors.push(`${viewport}:write-boundary-unverified`);
    const review = attempt.review;
    if (!review) continue;
    if (review.disposition === "rejected") errors.push(`${viewport}:review-rejected`);
    if (review.openedImage !== true || review.targetLegible !== true || review.contextCorrect !== true ||
      review.privacySafe !== true || review.noClippingOrOverlap !== true || review.sha256 !== attempt.sha256 ||
      review.candidateCommit !== run.candidateCommit || !nonblank(review.reviewedBy) ||
      review.reviewedBy === attempt.capturedBy || !date(review.reviewedAt) ||
      Date.parse(review.reviewedAt) < Date.parse(attempt.capturedAt) || review.disposition !== "accepted")
      errors.push(`${viewport}:independent-exact-image-review-required`);
  }
  if (errors.length) return { status: errors.some((error) => error.endsWith("review-rejected")) ? "review-rejected" : "blocked", errors };
  if (run.attempts.filter((attempt) => attempt.selected).some((attempt) => !attempt.review))
    return { status: "captured-unreviewed", errors };
  return { status: "reviewed-instruction-only", errors,
    limitation: "Artifact attestations only, not proof of business transition, enforcement, user acceptance or human pilot completion." };
}
