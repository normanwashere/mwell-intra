import { useEffect, useState } from 'react';
import { resolveEvidenceUrl } from '@/data/supabase/evidence';
import { Icon } from './Icon';

interface EvidenceGalleryProps {
  /** Persisted evidence values: storage paths or base64 data URLs. */
  urls?: string[];
  /** Compact grid (default) or a single thumbnail. */
  size?: 'grid' | 'thumb';
  className?: string;
}

/**
 * Renders captured evidence (storage paths or data URLs) as a clickable grid of
 * thumbnails that open a lightbox. Paths are resolved to signed URLs on mount.
 */
export function EvidenceGallery({
  urls,
  size = 'grid',
  className,
}: EvidenceGalleryProps) {
  const list = urls ?? [];
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const entries: [string, string | null][] = [];
      for (const u of list) {
        if (resolved[u] !== undefined) continue;
        entries.push([u, await resolveEvidenceUrl(u)]);
      }
      if (active && entries.length > 0) {
        setResolved((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => {
      active = false;
    };
  }, [list, resolved]);

  if (list.length === 0) return null;

  if (size === 'thumb' && list.length > 0) {
    const first = list[0]!;
    const src = resolved[first] ?? undefined;
    return (
      <button
        type="button"
        onClick={() => setLightbox(src ?? first)}
        className={`relative inline-block ${className ?? ''}`}
        aria-label={`View ${list.length} evidence photo(s)`}
      >
        {src ? (
          <img
            src={src}
            alt="Evidence"
            className="h-12 w-12 rounded-lg object-cover ring-1 ring-line"
          />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-inset text-faint ring-1 ring-line">
            <Icon name="camera" className="h-5 w-5" />
          </span>
        )}
        {list.length > 1 && (
          <span className="absolute -bottom-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[0.6rem] font-bold text-white">
            {list.length}
          </span>
        )}
        {lightbox && (
          <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
        )}
      </button>
    );
  }

  return (
    <div className={className}>
      <ul className="grid grid-cols-4 gap-2" aria-label="Evidence photos">
        {list.map((u) => {
          const src = resolved[u] ?? undefined;
          return (
            <li key={u}>
              <button
                type="button"
                onClick={() => setLightbox(src ?? u)}
                className="block w-full"
                aria-label="View evidence photo"
              >
                {src ? (
                  <img
                    src={src}
                    alt="Evidence"
                    className="aspect-square w-full rounded-xl object-cover ring-1 ring-line"
                  />
                ) : (
                  <span className="grid aspect-square w-full place-items-center rounded-xl bg-inset text-faint ring-1 ring-line">
                    <Icon name="camera" className="h-5 w-5" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Evidence photo"
      className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white"
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
      <img
        src={src}
        alt="Evidence"
        className="max-h-full max-w-full rounded-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
