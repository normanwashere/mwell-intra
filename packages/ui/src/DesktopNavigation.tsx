"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const STORAGE_KEY = "intra.desktop-navigation.hidden";
const CHANGE_EVENT = "intra:desktop-navigation";

export function useDesktopNavigation() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setHidden(localStorage.getItem(STORAGE_KEY) === "true"); }
      catch { /* Navigation still works when browser storage is unavailable. */ }
    };
    const changed = (event: Event) => setHidden((event as CustomEvent<boolean>).detail);
    const stored = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) read();
    };
    read();
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener("storage", stored);
    return () => {
      window.removeEventListener(CHANGE_EVENT, changed);
      window.removeEventListener("storage", stored);
    };
  }, []);

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); }
    catch { /* Keep the current page usable without persistence. */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  };
  return { hidden, toggle };
}

export function DesktopNavigationToggle({ hidden, onToggle, controls }: {
  hidden: boolean;
  onToggle: () => void;
  controls: string;
}) {
  const label = hidden ? "Show side navigation" : "Hide side navigation";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={!hidden}
      aria-controls={controls}
      className="hidden h-11 w-11 shrink-0 place-items-center rounded-md border border-line text-muted hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:grid"
    >
      <Icon name="menu" className="h-5 w-5" />
    </button>
  );
}
