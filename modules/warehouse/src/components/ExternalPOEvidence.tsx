import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useSession, type WarehouseSessionValue } from "@/auth/session";
import { Icon } from "./Icon";

const BUCKET = "warehouse-po-evidence";
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const PATH = new RegExp(
  `^${BUCKET}/(${UUID}/${UUID}/[a-zA-Z0-9_-]+\\.(pdf|png|jpg|jpeg|webp))$`,
  "i",
);
type EvidenceSession = Pick<
  WarehouseSessionValue,
  "mode" | "profile" | "supabaseClient"
>;

function bytesOf(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this document."));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

export async function uploadExternalPOEvidence(
  file: File,
  session: EvidenceSession,
): Promise<string> {
  if (
    session.mode !== "supabase" ||
    !session.supabaseClient ||
    !session.profile ||
    !new RegExp(`^${UUID}$`, "i").test(session.profile.id)
  ) {
    throw new Error("A signed-in connection is required for PO documents.");
  }
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Attach PDF, PNG, JPEG or WebP files only.");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Each document must be no larger than 8 MiB.");
  const bytes = await bytesOf(file);
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const valid =
    extension === "pdf"
      ? starts(0x25, 0x50, 0x44, 0x46, 0x2d)
      : extension === "png"
        ? starts(137, 80, 78, 71, 13, 10, 26, 10)
        : extension === "jpg"
          ? starts(255, 216, 255)
          : starts(82, 73, 70, 70) &&
            [87, 69, 66, 80].every(
              (value, index) => bytes[index + 8] === value,
            );
  if (!valid)
    throw new Error("The file signature does not match its document type.");
  const objectPath = `${session.profile.id}/${crypto.randomUUID()}/document.${extension}`;
  const { error } = await session.supabaseClient.storage
    .from(BUCKET)
    .upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Document upload failed: ${error.message}`);
  return `${BUCKET}/${objectPath}`;
}

function DocumentLink({ value, index }: { value: string; index: number }) {
  const { mode, profile, supabaseClient } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const match = PATH.exec(value);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    const path = PATH.exec(value)?.[1];
    if (!path || mode !== "supabase" || !profile || !supabaseClient) {
      setFailed(true);
      return;
    }
    void (async () => {
      try {
        const { data, error } = await supabaseClient.storage
          .from(BUCKET)
          .createSignedUrl(path, 300);
        if (
          error ||
          !data?.signedUrl ||
          new URL(data.signedUrl).protocol !== "https:"
        )
          throw new Error("Unavailable");
        if (active) setUrl(data.signedUrl);
      } catch {
        if (active) setFailed(true);
      }
    })();
    // Expired links are replaced on demand; no public URL or executable embed fallback.
    const expiry = window.setTimeout(() => {
      if (active) {
        setUrl(null);
        setFailed(true);
      }
    }, 290_000);
    return () => {
      active = false;
      window.clearTimeout(expiry);
    };
  }, [value, mode, profile?.id, supabaseClient, attempt]);
  const kind = match?.[2]?.toLowerCase() === "pdf" ? "PDF" : "image";
  if (failed)
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span role="alert">Document unavailable</span>
        {match && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry document {index + 1}
          </button>
        )}
      </span>
    );
  if (!url)
    return (
      <span role="status" className="text-sm text-muted">
        Loading document {index + 1}...
      </span>
    );
  return (
    <a
      className="inline-flex min-h-11 items-center gap-2 text-sm text-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="download" />
      Open PO document {index + 1} ({kind})
    </a>
  );
}

export function ExternalPOEvidence({
  value,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  value: string[];
  onChange?: (value: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const session = useSession();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const latest = useRef({ value, onChange, onBusyChange });
  latest.current = { value, onChange, onBusyChange };
  useLayoutEffect(() => {
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setError("");
    return () => {
      generation.current++;
      latest.current.onBusyChange?.(false);
    };
  }, [session.mode, session.profile?.id, session.supabaseClient]);

  const upload = async (files: File[]) => {
    if (disabled || inFlight.current || !onChange) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    latest.current.onBusyChange?.(true);
    const token = generation.current;
    try {
      for (const file of files) {
        if (token !== generation.current) return;
        if (latest.current.value.length >= 20)
          throw new Error("Attach up to 20 supporting files.");
        const stored = await uploadExternalPOEvidence(file, session);
        if (token !== generation.current) return;
        const next = [...latest.current.value, stored];
        latest.current.value = next;
        latest.current.onChange?.(next);
      }
    } catch (cause) {
      if (token === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Document upload failed.",
        );
    } finally {
      if (token === generation.current) {
        inFlight.current = false;
        setBusy(false);
        latest.current.onBusyChange?.(false);
      }
    }
  };

  return (
    <div className="space-y-2">
      {onChange && (
        <div>
          <label htmlFor={id} className="label">
            Attach PO documents
          </label>
          <input
            id={id}
            className="block w-full min-w-0 text-sm"
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={
              disabled ||
              busy ||
              value.length >= 20 ||
              session.mode !== "supabase" ||
              !session.profile
            }
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void upload(files);
            }}
          />
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted">
          Uploading documents...
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="divide-y divide-line" aria-label="PO documents">
          {value.map((path, index) => (
            <li
              key={`${path}-${index}`}
              className="flex min-w-0 items-center justify-between gap-2 py-1"
            >
              <DocumentLink
                key={`${session.profile?.id}-${path}`}
                value={path}
                index={index}
              />
              {onChange && (
                <button
                  type="button"
                  className="btn-ghost h-11 w-11 shrink-0"
                  title={`Remove document ${index + 1}`}
                  aria-label={`Remove document ${index + 1}`}
                  disabled={disabled || busy}
                  onClick={() => onChange(value.filter((_, n) => n !== index))}
                >
                  <Icon name="x" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
