"use client";
import { useState } from "react";
import { Icon } from "./Icon";

export function RecordCopyActions({ reference, href }: { reference: string; href: string }) {
  const [message, setMessage] = useState("");
  const copy = async (kind: "reference" | "link") => {
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Invalid record link");
      await navigator.clipboard.writeText(kind === "reference" ? reference : url.href);
      setMessage(kind === "reference" ? "Reference copied." : "Record link copied.");
    } catch {
      setMessage("Could not copy. Select the reference or copy the page address instead.");
    }
  };
  return <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Record sharing">
    <button type="button" className="btn-ghost h-11 w-11 shrink-0 justify-center p-0" aria-label="Copy reference" title="Copy reference" onClick={() => void copy("reference")}><Icon name="clipboard" className="h-4 w-4" /></button>
    <button type="button" className="btn-ghost h-11 w-11 shrink-0 justify-center p-0" aria-label="Copy record link" title="Copy record link" onClick={() => void copy("link")}><Icon name="link" className="h-4 w-4" /></button>
    <span role="status" className="min-w-0 text-xs text-muted">{message}</span>
  </div>;
}
