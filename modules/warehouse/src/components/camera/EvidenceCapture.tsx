import { useRef, useState } from 'react';
import { Icon } from '../Icon';
import { resolveDataSource } from '@/data/createRepository';
import { uploadEvidence } from '@/data/supabase/evidence';

interface EvidenceCaptureProps {
  onChange: (urls: string[]) => void;
  label?: string;
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
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

export function EvidenceCapture({
  onChange,
  label = 'Capture photo evidence',
  reference,
}: EvidenceCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const source = resolveDataSource();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const next = [...urls];
    let rejected = 0;
    const toUpload: string[] = [];
    for (const file of Array.from(files)) {
      if (next.length + toUpload.length >= MAX_PHOTOS) {
        setError(`Up to ${MAX_PHOTOS} photos.`);
        break;
      }
      if (!file.type.startsWith('image/')) {
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
    if (rejected > 0) {
      setError(`Skipped ${rejected} file(s): images up to ${MAX_SIZE_MB}MB only.`);
    }

    let persisted: string[] = toUpload;
    if (source === 'supabase' && toUpload.length > 0) {
      setUploading(true);
      try {
        const ref = reference ?? `capture-${Date.now()}`;
        persisted = await Promise.all(
          toUpload.map((u, i) => uploadEvidence(u, `${ref}/${i}`)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not upload evidence.');
        return;
      } finally {
        setUploading(false);
      }
    }
    const combined = [...next, ...persisted];
    setUrls(combined);
    onChange(combined);
  };

  const removeAt = (index: number) => {
    const next = urls.filter((_, i) => i !== index);
    setUrls(next);
    onChange(next);
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
        {uploading ? 'Uploading…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        aria-label={label}
        onChange={(e) => void handleFiles(e.target.files)}
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
  const [src, setSrc] = useState<string | null>(url.startsWith('data:') ? url : null);
  if (!src && !url.startsWith('data:')) {
    // Storage path — resolve once for the preview. Errors fall back to a placeholder.
    void resolveEvidenceUrlSafe(url).then((u) => setSrc(u));
  }
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
    const { resolveEvidenceUrl } = await import('@/data/supabase/evidence');
    return resolveEvidenceUrl(value);
  } catch {
    return null;
  }
}
