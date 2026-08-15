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
  it("keeps a learner on the decision after an unsafe choice and checkpoints only correct choices", async () => {
    const target = anchor();
    const onCheckpoint = vi.fn().mockResolvedValue(undefined);
    render(
      <OnboardingTrainingSession
        requirementTitle="Create a governed request and handoff"
        assignmentRequirementId="assignment-general-employee"
        attemptId="attempt-general-employee"
        scenarioId="employee-request-handoff-v1"
        launcherRef={createRef<HTMLElement>()}
        onCheckpoint={onCheckpoint}
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Chat is not the authoritative request record",
    );
    expect(onCheckpoint).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add the missing purpose, date, cost center, owner, and evidence",
      }),
    );
    await waitFor(() => expect(onCheckpoint).toHaveBeenCalledTimes(1));
    expect(onCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkpointId: "draft-source-request",
        outcomeId: "draft-source-request",
        terminal: false,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Confirm the accountable handoff" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit it to Procurement and monitor the recorded status",
      }),
    );
    await waitFor(() => expect(onCheckpoint).toHaveBeenCalledTimes(2));
    expect(onCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkpointId: "confirm-accountable-handoff",
        outcomeId: "confirm-accountable-handoff",
        terminal: true,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Guided practice complete" }),
    ).toBeInTheDocument();

    target.remove();
  });
});
