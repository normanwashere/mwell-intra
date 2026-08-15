import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingTrainingSession } from "./OnboardingTrainingSession";

function anchor() {
  const element = document.createElement("section");
  element.dataset.onboardingAnchor = "onboarding-required-steps";
  document.body.append(element);
  vi.spyOn(element, "getClientRects").mockReturnValue({
    0: element.getBoundingClientRect(),
    length: 1,
    item: () => element.getBoundingClientRect(),
    [Symbol.iterator]: function* () {
      yield element.getBoundingClientRect();
    },
  } as DOMRectList);
  return element;
}

describe("OnboardingTrainingSession", () => {
  it("keeps a learner on the decision until the server accepts the choice", async () => {
    const target = anchor();
    const onCheckpoint = vi.fn().mockResolvedValue(undefined);
    const onEvaluateChoice = vi.fn(async (input: { choiceId: string }) =>
      input.choiceId === "submit-now"
        ? {
            accepted: false as const,
            feedback:
              "Chat is not the authoritative request record and leaves the handoff incomplete.",
          }
        : { accepted: true as const },
    );
    render(
      <OnboardingTrainingSession
        requirementTitle="Create a governed request and handoff"
        assignmentRequirementId="assignment-general-employee"
        attemptId="attempt-general-employee"
        scenarioId="employee-request-handoff-v1"
        launcherRef={createRef<HTMLElement>()}
        onCheckpoint={onCheckpoint}
        onEvaluateChoice={onEvaluateChoice}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Draft the source request" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit now and explain the details through chat",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Chat is not the authoritative request record",
    );
    expect(onEvaluateChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        simulationId: "employee-request-handoff-v1",
        checkpointId: "draft-source-request",
        choiceId: "submit-now",
      }),
    );
    expect(onCheckpoint).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add the missing purpose, date, cost center, owner, and evidence",
      }),
    );
    await waitFor(() => expect(onEvaluateChoice).toHaveBeenCalledTimes(2));
    expect(onEvaluateChoice).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkpointId: "draft-source-request",
        choiceId: "complete-request",
      }),
    );
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Confirm the accountable handoff" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit it to Procurement and monitor the recorded status",
      }),
    );
    await waitFor(() => expect(onEvaluateChoice).toHaveBeenCalledTimes(3));
    expect(onEvaluateChoice).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkpointId: "confirm-accountable-handoff",
        choiceId: "submit-owner",
      }),
    );
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Guided practice complete" }),
    ).toBeInTheDocument();

    target.remove();
  });
});
