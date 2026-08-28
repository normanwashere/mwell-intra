import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesDraftShape, useIntakeDraft, useIntakeScope } from "./intakeDraft";

const identity = vi.hoisted(() => ({ profile: { id: "operator-a" } as { id: string } | null, actor: "shared-role@mwell" }));
vi.mock("@/auth/session", () => ({ useSession: () => ({ profile: identity.profile, mode: "memory" }) }));
vi.mock("@/app/store", () => ({ useWarehouse: () => ({ source: "memory", actor: identity.actor }) }));

const initial = { reference: "", lines: [{ productId: "sku", quantity: 1 }] };
const validate = (value: unknown): value is typeof initial => matchesDraftShape(value, initial);
const mount = (scope = "draft:operator-a:return:new") => renderHook(() => useIntakeDraft(scope, initial, validate));

afterEach(() => { vi.restoreAllMocks(); identity.profile = { id: "operator-a" }; });

describe("scoped intake drafts", () => {
  it("does not warn on refresh after editable progress is durably saved", () => {
    const draft = mount();
    act(() => { draft.result.current.update({ ...initial, reference: "SAVED" }); });
    const leave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, leave);
    expect(leave.defaultPrevented).toBe(false);
    draft.unmount();
    expect(mount().result.current.value.reference).toBe("SAVED");
  });

  it("warns for a durable pending command until it is resolved", () => {
    const draft = renderHook(() => useIntakeDraft("pending", initial, validate, (value) => value.reference === "PENDING"));
    act(() => { draft.result.current.replace({ ...initial, reference: "PENDING" }, true); });
    const leave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, leave);
    expect(leave.defaultPrevented).toBe(true);
    act(() => { draft.result.current.clear(); });
    const cleared = new Event("beforeunload", { cancelable: true });
    fireEvent(window, cleared);
    expect(cleared.defaultPrevented).toBe(false);
  });

  it("stops warning once unsaved edits are durably saved", () => {
    const draft = mount();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Full"); });
    act(() => { draft.result.current.update({ ...initial, reference: "RETRY" }); });
    act(() => { draft.result.current.replace(draft.result.current.value, true); });
    const leave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, leave);
    expect(leave.defaultPrevented).toBe(false);
    storage.mockRestore();
  });

  it.each([false, true])("timestamps saves and preserves old drafts for review without expiring pending commands (pending=%s)", (pending) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const scope = "draft:old";
    const first = renderHook(() => useIntakeDraft(scope, initial, validate, () => pending));
    act(() => { first.result.current.update({ ...initial, reference: "KEEP" }); });
    const raw = localStorage.getItem(scope)!;
    expect(JSON.parse(raw).updatedAt).toBe(Date.now());
    first.unmount();
    now.mockReturnValue(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const reloaded = renderHook(() => useIntakeDraft(scope, initial, validate, () => pending));
    expect(reloaded.result.current.reviewRequired).toBe(!pending);
    expect(reloaded.result.current.value.reference).toBe("KEEP");
    expect(localStorage.getItem(scope)).toBe(raw);
  });

  it("uses authenticated profile and record identity, not just a shared actor or role", () => {
    const first = renderHook(() => useIntakeScope("return:new"));
    const a = first.result.current;
    identity.profile = { id: "operator-b" };
    first.rerender();
    expect(first.result.current).not.toBe(a);
    const order = renderHook(() => useIntakeScope("order:new"));
    expect(order.result.current).not.toBe(first.result.current);
    identity.profile = null;
    first.rerender();
    expect(first.result.current).toBeNull();
  });

  it("keeps drafts separate by actor and record and does not autosubmit on resume", () => {
    const first = mount();
    act(() => { first.result.current.update({ ...initial, reference: "RETURN-A" }); });
    first.unmount();
    expect(mount("draft:operator-b:return:new").result.current.value.reference).toBe("");
    expect(mount("draft:operator-a:order:new").result.current.value.reference).toBe("");
    const resumed = mount();
    expect(resumed.result.current.needsResume).toBe(true);
    act(() => { resumed.result.current.resume(); });
    expect(resumed.result.current.value.reference).toBe("RETURN-A");
    expect(resumed.result.current.needsResume).toBe(false);
  });

  it("refuses stale writes and stale success cleanup, then loads the latest revision", () => {
    const first = mount();
    const second = mount();
    act(() => { first.result.current.update({ ...initial, reference: "FIRST" }); });
    act(() => { expect(second.result.current.update({ ...initial, reference: "SECOND" })).toBe(false); });
    expect(second.result.current.conflict).toBe(true);
    act(() => { expect(second.result.current.clear()).toBe(false); });
    act(() => { second.result.current.resume(); });
    expect(second.result.current.value.reference).toBe("FIRST");
    act(() => { second.result.current.update({ ...initial, reference: "NEWER" }); });
    first.unmount();
    act(() => { expect(first.result.current.clear()).toBe(false); });
    expect(mount().result.current.value.reference).toBe("NEWER");
  });

  it("detects other-tab writes on focus and storage events without overwriting local input", () => {
    const first = mount();
    act(() => { first.result.current.update({ ...initial, reference: "LOCAL" }); });
    const raw = JSON.parse(localStorage.getItem("draft:operator-a:return:new")!);
    localStorage.setItem("draft:operator-a:return:new", JSON.stringify({ ...raw, value: { ...initial, reference: "REMOTE" } }));
    fireEvent(window, new StorageEvent("storage", { key: "draft:operator-a:return:new" }));
    expect(first.result.current.conflict).toBe(true);
    expect(first.result.current.value.reference).toBe("LOCAL");
    act(() => { first.result.current.resume(); });
    localStorage.removeItem("draft:operator-a:return:new");
    fireEvent.focus(window);
    expect(first.result.current.conflict).toBe(true);
  });

  it("retains unsaved work and blocks durable submission when storage is full", () => {
    const first = mount();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    act(() => { expect(first.result.current.update({ ...initial, reference: "UNSAVED" })).toBe(false); });
    expect(first.result.current.value.reference).toBe("UNSAVED");
    expect(first.result.current.error).toMatch(/could not be saved/);
    act(() => { expect(first.result.current.replace({ ...initial, reference: "PENDING" }, true)).toBe(false); });
    expect(first.result.current.value.reference).toBe("UNSAVED");
    const leave = new Event("beforeunload", { cancelable: true });
    fireEvent(window, leave);
    expect(leave.defaultPrevented).toBe(true);
    storage.mockRestore();
    act(() => { expect(first.result.current.replace(first.result.current.value, true)).toBe(true); });
    first.unmount();
    expect(mount().result.current.value.reference).toBe("UNSAVED");
  });

  it.each(["{bad json", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, scope: "another-user", value: initial })])(
    "does not overwrite an unreadable or wrong-scope draft: %s", (raw) => {
      localStorage.setItem("draft:operator-a:return:new", raw);
      const first = mount();
      expect(first.result.current.error).toBeTruthy();
      act(() => { expect(first.result.current.replace(initial, true)).toBe(false); });
      expect(localStorage.getItem("draft:operator-a:return:new")).toBe(raw);
    },
  );

  it("clears only its own draft after success, including an unmounted owner", () => {
    const first = mount();
    const other = mount("draft:operator-b:return:new");
    act(() => { first.result.current.update({ ...initial, reference: "A" }); other.result.current.update({ ...initial, reference: "B" }); });
    first.unmount();
    expect(first.result.current.clear()).toBe(true);
    expect(mount().result.current.needsResume).toBe(false);
    expect(mount("draft:operator-b:return:new").result.current.value.reference).toBe("B");
  });

  it("rejects malformed nested draft fields", () => {
    expect(validate({ ...initial, lines: [{ productId: "sku", quantity: "2" }] })).toBe(false);
    expect(validate({ ...initial, lines: [{ productId: "sku", quantity: NaN }] })).toBe(false);
    expect(validate({ ...initial, lines: null })).toBe(false);
  });
});
