"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { headerPopoverBounds } from "./headerPopoverBounds";

export function useHeaderPopoverBounds(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  preferredWidthRem: number,
) {
  const [bounds, setBounds] = useState<ReturnType<typeof headerPopoverBounds>>();
  useLayoutEffect(() => {
    if (!open) return;
    const navigation = document.querySelector<HTMLElement>("[data-shell-mobile-nav]");
    const measure = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const nav = navigation?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const next = headerPopoverBounds({
        anchorRight: anchor.right,
        anchorBottom: anchor.bottom,
        anchorHeight: anchor.height,
        viewportWidth: document.documentElement.clientWidth,
        viewportBottom: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
        navigationTop: nav && nav.height > 0 ? nav.top : undefined,
        rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
        preferredWidthRem,
      });
      setBounds((previous) => previous?.top === next.top && previous.width === next.width &&
        previous.maxHeight === next.maxHeight ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (navigation) observer.observe(navigation);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [open, preferredWidthRem, triggerRef]);
  return bounds;
}
