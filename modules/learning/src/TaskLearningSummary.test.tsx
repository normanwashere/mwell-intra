import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskLearningSummary } from "./TaskLearningSummary";
import type { TaskLearningProjection } from "./taskReadiness";

const task = {
  id: "receive",
  title: "Receive a delivery",
  outcome: "Record inspected delivery evidence",
  actionCapabilities: [],
};
const projection: TaskLearningProjection = {
  status: "known",
  neededNow: [],
  otherRequired: [],
  optional: [],
};
describe("TaskLearningSummary", () => {
  it('promotes one next task requirement and keeps the remaining chain expandable', () => {
    const requirement = { id: 'first', version: 1, audience: 'internal' as const, kind: 'orientation' as const, title: 'Safety orientation', mandatory: true, prerequisiteIds: [], capabilityOutcomes: [] };
    render(<TaskLearningSummary task={task} projection={{ ...projection, neededNow: [requirement, { ...requirement, id: 'second', title: 'Receiving practice', prerequisiteIds: ['first'] }] }} />);
    expect(screen.getByText('Safety orientation').closest('details')).toBeNull();
    const remaining = screen.getByText('Receiving practice').closest('details');
    expect(remaining).not.toBeNull();
    expect(remaining).not.toHaveAttribute('open');
    expect(screen.getByText('2 requirements remaining for this task')).toBeInTheDocument();
    fireEvent.click(remaining!.querySelector('summary')!);
    expect(remaining).toHaveAttribute('open');
  });
  it("shows a compact task outcome and disclosures without promising access", () => {
    render(<TaskLearningSummary task={task} projection={projection} />);
    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(task.outcome)).toBeInTheDocument();
    expect(
      screen.getByText(/Role permissions and record checks still apply/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Other required learning (0 outstanding, 0 completed)").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("Optional guidance (0)").closest("details"),
    ).not.toHaveAttribute("open");
  });
  it("refreshes in place, prevents duplicate refreshes, and exposes rejected retry", async () => {
    let reject!: (error: Error) => void;
    const refresh = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<><input aria-label="Draft reference" defaultValue="UNSAVED-42" /><TaskLearningSummary task={task} projection={{ ...projection, status: "unavailable" }} onRefresh={refresh} /></>);
    const draft = screen.getByLabelText("Draft reference");
    fireEvent.click(screen.getByRole("button", { name: "Refresh task readiness" }));
    expect(screen.getByRole("button", { name: "Refreshing task readiness" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing task readiness");
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be refreshed");
    expect(screen.getByRole("button", { name: "Refresh task readiness" })).toBeEnabled();
    expect(screen.getByLabelText("Draft reference")).toBe(draft);
    expect(draft).toHaveValue("UNSAVED-42");
    expect(screen.getByRole("heading", { name: task.title })).toBeVisible();
    expect(screen.queryByText(/No outstanding learning/)).not.toBeInTheDocument();
  });

  it("counts exact completed and outstanding other obligations without title-based credit", () => {
    const requirement = { id: "one", version: 1, audience: "internal" as const, kind: "orientation" as const, title: "Same title", mandatory: true, prerequisiteIds: [], capabilityOutcomes: [] };
    render(<TaskLearningSummary task={task} projection={{ ...projection, otherRequired: [requirement, { ...requirement, id: "two" }] }} progress={[{ assignmentRequirementId: "one", requirementId: "one", requirementVersion: 1, state: "passed", attemptCount: 1, allowsSharedCompletion: false, updatedAt: "2026-09-07" }]} />);
    expect(screen.getByText("Other required learning (1 outstanding, 1 completed)").closest("details")).not.toHaveAttribute("open");
  });
  it("uses refreshed projection rather than resolving a promise as proof of readiness", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<TaskLearningSummary task={task} projection={{ ...projection, status: "unavailable" }} onRefresh={refresh} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh task readiness" })));
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.queryByText(/No outstanding learning/)).not.toBeInTheDocument();
    rerender(<TaskLearningSummary task={task} projection={{ ...projection, status: "unavailable" }} onRefresh={refresh} refreshError="readback failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be refreshed");
    rerender(<TaskLearningSummary task={task} projection={projection} onRefresh={refresh} />);
    expect(screen.getByText(/Role permissions and record checks still apply/)).toBeVisible();
    expect(screen.getByRole("heading", { name: task.title })).toBeVisible();
  });

  it("ignores a rejected refresh from a previously selected task", async () => {
    let reject!: (error: Error) => void;
    const refresh = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const unavailable = { ...projection, status: "unavailable" as const };
    const { rerender } = render(<TaskLearningSummary task={task} projection={unavailable} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh task readiness" }));
    rerender(<TaskLearningSummary task={{ ...task, id: "inspect", title: "Inspect quality" }} projection={unavailable} onRefresh={refresh} />);
    await act(async () => reject(new Error("old failure")));
    expect(screen.getByRole("heading", { name: "Inspect quality" })).toBeVisible();
    expect(screen.getByRole("alert")).not.toHaveTextContent("could not be refreshed");
    expect(screen.getByRole("button", { name: "Refresh task readiness" })).toBeEnabled();
  });
  it("does not show a ready claim for an unavailable projection", () => {
    render(
      <TaskLearningSummary
        task={task}
        projection={{ ...projection, status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(
      screen.queryByText(/No outstanding learning/),
    ).not.toBeInTheDocument();
  });
});
