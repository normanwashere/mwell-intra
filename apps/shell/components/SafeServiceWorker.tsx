"use client";

import React, { useEffect, type ReactNode } from "react";
import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";

function RegisterServiceWorker() {
  const { serwist } = useSerwist();
  useEffect(() => {
    if (!serwist) return;
    // Registration can be rejected by browser policy. It must not interrupt online work.
    void serwist.register().catch(() => {
      console.warn("Offline support is unavailable. Online work remains available.");
    });
  }, [serwist]);
  return null;
}

export function SafeServiceWorker({ children }: { children: ReactNode }) {
  return <SerwistProvider swUrl="/serwist/sw.js" register={false} reloadOnOnline={false}>
    <RegisterServiceWorker />
    {children}
  </SerwistProvider>;
}
