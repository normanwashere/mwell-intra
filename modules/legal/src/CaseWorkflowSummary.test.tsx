import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CaseWorkflowSummary,
  caseWorkflowSummary,
  type CaseWorkflowInput,
} from "./CaseWorkflowSummary";

const base: CaseWorkflowInput = {
  kase: {},
  status: "submitted",
  requiredCount: 2,
  outstandingCount: 0,
  awaitingReviewCount: 2,
  readyForDecision: false,
};

describe("case workflow summary", () => {
  it.each([
    ["draft", "Vendor"],
    ["submitted", "Legal reviewer"],
    ["under_review", "Legal reviewer"],
    ["approved", "Legal (renewal monitoring)"],
    ["provisional", "Legal / vendor"],
    ["rejected", "Vendor / Legal"],
    ["expired", "Legal / vendor"],
    ["renewal_due", "Legal / vendor"],
  ] as const)("maps %s to a role responsibility", (status, owner) => {
    const summary = caseWorkflowSummary({ ...base, status });
    expect(summary.owner).toBe(owner);
    expect(summary.nextStep).toBeTruthy();
    if (status !== "approved") expect(summary.tone).not.toBe("success");
  });
  it("routes a recorded correction to the vendor and retains its reason", () => {
    expect(
      caseWorkflowSummary({
        ...base,
        status: "correction_requested",
        kase: {
          correctionRequest: {
            note: "Correct the registration number",
            revision: 2,
            sourceVersion: 1,
            requestedAt: "2026-09-11",
          },
        },
      }),
    ).toMatchObject({
      owner: "Vendor",
      blocker: "Correct the registration number",
    });
  });
  it("does not offer application editing when correction metadata is missing", () => {
    expect(
      caseWorkflowSummary({ ...base, status: "correction_requested" }),
    ).toMatchObject({
      owner: "Legal",
      blocker: "Correction details are unavailable.",
    });
  });
  it("prioritizes independent confirmation over a proposed approval", () => {
    expect(
      caseWorkflowSummary({
        ...base,
        status: "approved",
        kase: { decisionPending: true },
      }),
    ).toMatchObject({ owner: "Independent Legal approver", tone: "warning" });
  });
  it("uses the existing readiness gate for the Legal decision handoff", () => {
    const summary = caseWorkflowSummary({ ...base, readyForDecision: true });
    expect(summary.owner).toBe("Legal approver");
    expect(summary.blocker).toBeUndefined();
  });
  it.each(["draft", "submitted", "under_review"] as const)(
    "does not call an empty %s checklist ready",
    (status) => {
      expect(
        caseWorkflowSummary({
          ...base,
          status,
          requiredCount: 0,
          readyForDecision: true,
        }),
      ).toMatchObject({
        blocker: "Required checklist coverage is unknown.",
        tone: "warning",
      });
    },
  );
  it("distinguishes missing evidence from evidence awaiting review", () => {
    expect(
      caseWorkflowSummary({ ...base, outstandingCount: 1 }).blocker,
    ).toContain("remain outstanding");
    expect(caseWorkflowSummary(base).blocker).toContain("await Legal review");
    expect(
      caseWorkflowSummary({ ...base, status: "draft", outstandingCount: 1 })
        .nextStep,
    ).toContain("Complete the outstanding evidence");
  });
  it.each([
    { outstandingCount: undefined },
    { outstandingCount: NaN },
    { outstandingCount: Infinity },
    { outstandingCount: -1 },
    { outstandingCount: 0.5 },
    { awaitingReviewCount: undefined },
    { awaitingReviewCount: NaN },
    { requiredCount: undefined },
    { requiredCount: Infinity },
    { requiredCount: -1 },
  ])(
    "does not infer submission or decision readiness from partial counts %j",
    (override) => {
      for (const status of ["draft", "submitted", "under_review"] as const) {
        const summary = caseWorkflowSummary({
          ...base,
          status,
          readyForDecision: true,
          ...override,
        });
        expect(summary).toMatchObject({
          owner: "Legal",
          blocker: "Required checklist coverage is unknown.",
          tone: "warning",
        });
        expect(summary.nextStep).not.toContain("attestation");
        expect(summary.nextStep).not.toContain(
          "record the accreditation decision",
        );
      }
    },
  );
  it("recovers submission guidance only once the derived counts are loaded", () => {
    const partial = {
      ...base,
      status: "draft" as const,
      outstandingCount: undefined,
      loading: true,
    };
    expect(caseWorkflowSummary(partial).owner).toBe("Not determined");
    expect(caseWorkflowSummary({ ...partial, loading: false }).blocker).toBe(
      "Required checklist coverage is unknown.",
    );
    const loaded = caseWorkflowSummary({
      ...partial,
      loading: false,
      outstandingCount: 0,
    });
    expect(loaded.nextStep).toContain("attestation");
    expect(loaded.blocker).toBeUndefined();
  });
  it("retains rejection reasons and bounds approval to accreditation", () => {
    expect(
      caseWorkflowSummary({
        ...base,
        status: "rejected",
        kase: { decisionNote: "Registration mismatch" },
      }).blocker,
    ).toBe("Registration mismatch");
    expect(
      caseWorkflowSummary({ ...base, status: "approved" }).nextStep,
    ).toContain("Procurement checks remain separate");
  });
  it.each([
    { readFailed: true },
    { loading: true },
    { kase: undefined },
    { status: "future" as CaseWorkflowInput["status"] },
  ])("does not infer readiness from unavailable input %j", (override) => {
    expect(caseWorkflowSummary({ ...base, ...override })).toMatchObject({
      owner: "Not determined",
      tone: "warning",
    });
  });
  it("renders the shared role caption and no duplicate action, and recovers after a failed read", () => {
    const failed = renderToStaticMarkup(
      createElement(CaseWorkflowSummary, { ...base, readFailed: true }),
    );
    expect(failed).toContain("Next responsibility");
    expect(failed).toContain("Case status unavailable");
    expect(failed).not.toContain("<button");
    const recovered = renderToStaticMarkup(
      createElement(CaseWorkflowSummary, { ...base, readyForDecision: true }),
    );
    expect(recovered).toContain("Legal approver");
    expect(recovered).not.toContain("Case status unavailable");
  });
});
