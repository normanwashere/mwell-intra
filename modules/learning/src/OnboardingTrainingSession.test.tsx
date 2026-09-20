import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingTrainingSession } from "./OnboardingTrainingSession";
import { LEARNING_CATALOG } from "./catalog";
import { evaluateSimulationChoice } from "./simulationChoiceAuthority.server";

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
  it("requires all six seller decisions without client checkpoint or certification shortcuts", async () => {
    const target = anchor();
    const simulation = LEARNING_CATALOG.simulations.find(item => item.id === "event-seller-custody-v1")!;
    const onCheckpoint = vi.fn();
    const onEvaluateChoice = vi.fn(async (input) => evaluateSimulationChoice(input));
    render(<OnboardingTrainingSession
      requirementTitle={simulation.title}
      requiredCheckpointIds={simulation.checkpointIds}
      assignmentRequirementId="named-seller-assignment"
      attemptId="named-seller-attempt"
      scenarioId={simulation.id}
      launcherRef={createRef<HTMLElement>()}
      onCheckpoint={onCheckpoint}
      onEvaluateChoice={onEvaluateChoice}
      onClose={vi.fn()}
    />);
    for (const step of simulation.embeddedSteps!) {
      expect(await screen.findByRole("heading", { name: step.title })).toBeInTheDocument();
      const rejected = step.choices!.find(choice => !evaluateSimulationChoice({ simulationId: simulation.id, checkpointId: step.checkpointId, choiceId: choice.id }).accepted)!;
      fireEvent.click(screen.getByRole("button", { name: rejected.label }));
      expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement();
      expect(screen.getByRole("heading", { name: step.title })).toBeInTheDocument();
      const accepted = step.choices!.find(choice => choice.id !== rejected.id)!;
      fireEvent.click(screen.getByRole("button", { name: accepted.label }));
    }
    expect(await screen.findByRole("heading", { name: "Guided practice complete" })).toBeInTheDocument();
    expect(onEvaluateChoice).toHaveBeenCalledTimes(12);
    expect(onCheckpoint).not.toHaveBeenCalled();
    target.remove();
  });
  it.each([2, 4])(
    "a fresh Operations Lead session ends after its %i assigned checkpoints",
    async (count) => {
      const target = anchor();
      const simulation = LEARNING_CATALOG.simulations.find(
        (item) => item.id === "operations-exception-review-v1",
      )!;
      const steps = simulation.embeddedSteps!.slice(0, count);
      const onEvaluateChoice = vi.fn().mockResolvedValue({ accepted: true });
      const onCheckpoint = vi.fn();
      render(
        <OnboardingTrainingSession
          requirementTitle="Operations practice"
          requiredCheckpointIds={steps.map((step) => step.checkpointId)}
          assignmentRequirementId={`assignment-ops-${count}`}
          attemptId={`fresh-ops-${count}`}
          scenarioId={simulation.id}
          launcherRef={createRef<HTMLElement>()}
          onCheckpoint={onCheckpoint}
          onEvaluateChoice={onEvaluateChoice}
          onClose={vi.fn()}
        />,
      );
      for (const step of steps) {
        expect(
          await screen.findByRole("heading", { name: step.title }),
        ).toBeInTheDocument();
        fireEvent.click(
          screen.getByRole("button", { name: step.choices![0]!.label }),
        );
      }
      expect(
        await screen.findByRole("heading", {
          name: "Guided practice complete",
        }),
      ).toBeInTheDocument();
      expect(
        onEvaluateChoice.mock.calls.map(([input]) => input.checkpointId),
      ).toEqual(steps.map((step) => step.checkpointId));
      expect(onCheckpoint).not.toHaveBeenCalled();
      target.remove();
    },
  );

  it.each([
    undefined,
    [],
    ["missing-checkpoint"],
    ["review-custody-evidence", "review-custody-evidence"],
  ])(
    "does not guess missing or unsupported assigned steps: %j",
    (requiredCheckpointIds) => {
      const onEvaluateChoice = vi.fn();
      const onCheckpoint = vi.fn();
      render(
        <OnboardingTrainingSession
          requirementTitle="Operations practice"
          requiredCheckpointIds={requiredCheckpointIds}
          assignmentRequirementId="assignment-invalid"
          attemptId="fresh-invalid"
          scenarioId="operations-exception-review-v1"
          launcherRef={createRef<HTMLElement>()}
          onCheckpoint={onCheckpoint}
          onEvaluateChoice={onEvaluateChoice}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        /contact your administrator/i,
      );
      expect(
        screen.queryByRole("heading", { name: "Review custody evidence" }),
      ).not.toBeInTheDocument();
      expect(onEvaluateChoice).not.toHaveBeenCalled();
      expect(onCheckpoint).not.toHaveBeenCalled();
    },
  );

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
        requiredCheckpointIds={[
          "draft-source-request",
          "confirm-accountable-handoff",
        ]}
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
      await screen.findByRole("heading", { name: "Guided practice complete" }),
    ).toBeInTheDocument();

    target.remove();
  });
});
