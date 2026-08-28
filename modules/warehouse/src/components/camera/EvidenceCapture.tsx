import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { resolveDataSource } from "@/data/createRepository";
import { uploadEvidence } from "@/data/supabase/evidence";

interface EvidenceCaptureProps {
  onChange: (urls: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  value?: string[];
  label?: string;
  maxPhotos?: number;
  /** Used as the Storage path prefix when uploading to Supabase Storage
   * (e.g. a receipt/return id). When omitted in live mode, a timestamp prefix
   * is used. In memory mode uploads are skipped (base64 is stored inline). */
  reference?: string;
}

/**
 * Photo evidence capture. Uses a file input with `capture="environment"` so it
 * opens the rear camera on phones, while also accepting gallery uploads on
 * desktop.
 *
 * In live (Supabase) mode each photo is uploaded to the private `evidence`
 * Storage bucket and the persisted value is the object PATH. In memory mode
 * (tests/offline demo) photos stay as base64 data URLs so they survive a reload
 * without any backend. Either way the caller stores a string per photo.
 */
const MAX_PHOTOS = 8;
const MAX_SIZE_MB = 8;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function EvidenceCapture({
  onChange,
  onBusyChange,
  value,
  label = "Capture photo evidence",
  maxPhotos = MAX_PHOTOS,
  reference,
}: EvidenceCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>(value ?? []);
  const currentUrls = useRef(value ?? []);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const source = resolveDataSource();

  // A finished upload must never notify the next record or an unmounted form.
  useLayoutEffect(() => {
    generation.current++;
    currentUrls.current = value ?? [];
    setUrls(currentUrls.current);
    setError(null);
    setUploading(false);
    inFlight.current = false;
    return () => {
      generation.current++;
      inFlight.current = false;
      callbacks.current.onBusyChange?.(false);
    };
  }, [reference]);

  useLayoutEffect(() => {
    if (value !== undefined) {
      currentUrls.current = value;
      setUrls(value);
    }
  }, [value]);

  const publish = (next: string[]) => {
    currentUrls.current = next;
    setUrls(next);
    callbacks.current.onChange(next);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || inFlight.current) return;
    const session = generation.current;
    const active = () => session === generation.current;
    inFlight.current = true;
    setUploading(true);
    callbacks.current.onBusyChange?.(true);
    setError(null);
    let rejected = 0;
    const toUpload: string[] = [];
    const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!active()) return;
        if (currentUrls.current.length + toUpload.length >= maxPhotos) {
          setError(`Up to ${maxPhotos} photo${maxPhotos === 1 ? "" : "s"}.`);
          break;
        }
        if (!file.type.startsWith("image/")) {
          rejected++;
          continue;
        }
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          rejected++;
          continue;
        }
        try {
          toUpload.push(await readAsDataUrl(file));
        } catch {
          rejected++;
        }
      }
      if (!active()) return;
      if (rejected > 0) {
        setError(
          `Skipped ${rejected} file(s): images up to ${MAX_SIZE_MB}MB only.`,
        );
      }

      let persisted: string[] = toUpload;
      if (source === "supabase" && toUpload.length > 0) {
        const ref = reference ?? `capture-${Date.now()}`;
        const results = await Promise.allSettled(
          toUpload.map((u, i) => uploadEvidence(u, `${ref}/${i}`)),
        );
        if (!active()) return;
        persisted = results.flatMap((result) => {
          if (result.status === "fulfilled") return [result.value];
          failures.push(
            result.reason instanceof Error
              ? result.reason.message
              : "Could not upload evidence.",
          );
          return [];
        });
        if (failures.length)
          setError(
            `${failures.length} upload(s) failed. ${failures[0]} Select the failed files to retry.`,
          );
      }
      if (active() && persisted.length)
        publish([...currentUrls.current, ...persisted]);
    } finally {
      if (active()) {
        inFlight.current = false;
        setUploading(false);
        callbacks.current.onBusyChange?.(false);
      }
    }
  };

  const removeAt = (index: number) => {
    publish(currentUrls.current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn-ghost w-full"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        <Icon name="camera" />
        {uploading ? "Uploading…" : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={maxPhotos > 1}
        disabled={uploading}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
      {urls.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="Captured evidence">
          {urls.map((url, index) => (
            <li key={`${url}-${index}`} className="relative">
              <CapturedThumb url={url} />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => removeAt(index)}
                className="group absolute -right-2 -top-2 grid min-h-11 min-w-11 place-items-center rounded-full text-white focus-visible:outline-none"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-rose-500 shadow group-focus-visible:ring-2 group-focus-visible:ring-rose-400 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface">
                  <Icon name="x" className="h-3.5 w-3.5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders a captured evidence value inline (data URL now; storage paths
 * resolve to a signed URL for the preview). */
function CapturedThumb({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(
    url.startsWith("data:") ? url : null,
  );
  useEffect(() => {
    let active = true;
    setSrc(url.startsWith("data:") ? url : null);
    if (!url.startsWith("data:"))
      void resolveEvidenceUrlSafe(url).then((u) => {
        if (active) setSrc(u);
      });
    return () => {
      active = false;
    };
  }, [url]);
  if (!src) {
    return (
      <span className="grid aspect-square w-full place-items-center rounded-xl bg-inset text-faint ring-1 ring-line">
        <Icon name="camera" className="h-5 w-5" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt="Evidence"
      className="aspect-square w-full rounded-xl object-cover ring-1 ring-line"
    />
  );
}

async function resolveEvidenceUrlSafe(value: string): Promise<string | null> {
  try {
    const { resolveEvidenceUrl } = await import("@/data/supabase/evidence");
    return resolveEvidenceUrl(value);
  } catch {
    return null;
  }
}
