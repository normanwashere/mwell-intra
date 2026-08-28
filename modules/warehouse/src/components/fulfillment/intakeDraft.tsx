import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useSession } from "@/auth/session";
import { useWarehouse } from "@/app/store";

export function useIntakeScope(record: "return:new" | "order:new") {
  const { profile, mode } = useSession();
  const { source, actor } = useWarehouse();
  return profile
    ? `intra.warehouse-intake.v1:${JSON.stringify([mode, source, profile.id, actor, record])}`
    : null;
}

// Validate browser data before using it as form state. It is never authority.
export function matchesDraftShape(value: unknown, template: unknown): boolean {
  if (template === null) return value === null;
  if (Array.isArray(template)) {
    return (
      Array.isArray(value) &&
      value.length <= 500 &&
      value.every((item) => matchesDraftShape(item, template[0]))
    );
  }
  if (typeof template === "object") {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.entries(template).every(([key, sample]) =>
        matchesDraftShape((value as Record<string, unknown>)[key], sample),
      )
    );
  }
  return (
    typeof value === typeof template &&
    (typeof value !== "number" || Number.isFinite(value))
  );
}

export function useIntakeDraft<T>(
  scope: string,
  initial: T,
  validate: (value: unknown) => value is T,
  recover?: (value: T) => boolean,
  inFlight = false,
) {
  const defaults = useRef(initial);
  const read = () => {
    const raw = localStorage.getItem(scope);
    if (!raw) return { raw, value: defaults.current, updatedAt: null };
    const saved = JSON.parse(raw);
    if (
      saved.version !== 1 ||
      saved.scope !== scope ||
      !validate(saved.value)
    ) {
      throw new Error(
        "This saved draft cannot be read. Keep it for support review.",
      );
    }
    return {
      raw,
      value: saved.value as T,
      updatedAt:
        typeof saved.updatedAt === "number" && Number.isFinite(saved.updatedAt)
          ? saved.updatedAt
          : null,
    };
  };
  const [loaded] = useState(() => {
    try {
      return { ...read(), error: "" };
    } catch {
      return {
        raw: null,
        value: initial,
        updatedAt: null,
        error:
          "Saved draft unavailable. Do not close this page until progress is saved.",
      };
    }
  });
  const current = useRef(loaded.value);
  const revision = useRef(loaded.raw);
  const [value, setValue] = useState(loaded.value);
  const [needsResume, setNeedsResume] = useState(
    !!loaded.raw && !recover?.(loaded.value),
  );
  const [error, setError] = useState(loaded.error);
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(!!loaded.raw);
  const [unsaved, setUnsaved] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(loaded.updatedAt);
  const pending = !!recover?.(value);
  const warnOnLeave = unsaved || pending || inFlight;
  const reviewRequired =
    dirty &&
    !pending &&
    updatedAt !== null &&
    Date.now() - updatedAt > 30 * 24 * 60 * 60 * 1000;
  const [generation, setGeneration] = useState(0);
  const mounted = useRef(true);

  const checkRevision = () => {
    if (localStorage.getItem(scope) !== revision.current) {
      setConflict(true);
      setError(
        "This draft changed in another tab. Load the latest draft before continuing.",
      );
      return false;
    }
    return true;
  };

  useEffect(() => {
    mounted.current = true;
    const check = () => {
      try {
        checkRevision();
      } catch {
        setError("Draft storage is unavailable. Keep this page open.");
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === scope || event.key === null) check();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("focus", check);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", check);
    };
  }, [scope]);

  useEffect(() => {
    if (!warnOnLeave) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [warnOnLeave]);

  const replace = (next: T, requireDurable = false) => {
    if (!mounted.current || needsResume || conflict) return false;
    try {
      if (!checkRevision()) return false;
      const savedAt = Date.now();
      const raw = JSON.stringify({
        version: 1,
        scope,
        revision: crypto.randomUUID(),
        updatedAt: savedAt,
        value: next,
      });
      localStorage.setItem(scope, raw);
      revision.current = raw;
      setUpdatedAt(savedAt);
      setUnsaved(false);
      setError("");
    } catch {
      setError(
        "Draft could not be saved on this device. Keep this page open and retry saving before submitting.",
      );
      if (requireDurable) return false;
      current.current = next;
      setValue(next);
      setDirty(true);
      setUnsaved(true);
      return false;
    }
    current.current = next;
    setValue(next);
    setDirty(true);
    return true;
  };
  const update = (next: SetStateAction<T>) =>
    replace(
      typeof next === "function"
        ? (next as (previous: T) => T)(current.current)
        : next,
    );
  const resume = () => {
    try {
      const saved = read();
      revision.current = saved.raw;
      current.current = saved.value;
      setValue(saved.value);
      setNeedsResume(false);
      setConflict(false);
      setError("");
      setDirty(!!saved.raw);
      setUnsaved(false);
      setUpdatedAt(saved.updatedAt);
      setGeneration((previous) => previous + 1);
      return true;
    } catch {
      setError("This saved draft cannot be read. Keep it for support review.");
      return false;
    }
  };
  const clear = (next = defaults.current) => {
    try {
      // A late successful response must never delete a newer tab's progress.
      if (!checkRevision()) return false;
      localStorage.removeItem(scope);
      revision.current = null;
      current.current = next;
      if (mounted.current) {
        setValue(next);
        setDirty(false);
        setUnsaved(false);
        setUpdatedAt(null);
        setNeedsResume(false);
        setError("");
        setGeneration((previous) => previous + 1);
      }
      return true;
    } catch {
      if (mounted.current)
        setError(
          "Draft cleanup failed. Keep this page open and retry cleanup.",
        );
      return false;
    }
  };
  return {
    value,
    current,
    update,
    replace,
    clear,
    resume,
    needsResume,
    error,
    conflict,
    dirty,
    reviewRequired,
    generation,
    mounted,
  };
}

export function IntakeDraftActions({
  draft,
  busy = false,
  locked = false,
}: {
  draft: {
    needsResume: boolean;
    error: string;
    conflict: boolean;
    dirty: boolean;
    reviewRequired: boolean;
    resume: () => boolean;
    clear: () => boolean;
  };
  busy?: boolean;
  locked?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Drafts are stored only in this browser on this device and may include
        customer addresses and evidence. They are not synced to other devices.
      </p>
      {draft.reviewRequired && (
        <p role="status" className="text-sm text-amber-700">
          This editable draft was saved more than 30 days ago. Review its
          details before submitting, or discard it if no longer needed.
        </p>
      )}
      {draft.error && (
        <p role="alert" className="text-sm text-amber-700">
          {draft.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(draft.needsResume || draft.conflict) && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={draft.resume}
          >
            {draft.conflict ? "Load latest draft" : "Resume draft"}
          </button>
        )}
        {draft.dirty && !locked && !draft.conflict && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => draft.clear()}
          >
            Discard draft
          </button>
        )}
      </div>
    </div>
  );
}
