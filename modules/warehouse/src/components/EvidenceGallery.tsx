import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
import { Modal } from '@intra/ui';
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
  const { supabaseClient, profile, mode } = useSession();
  const listKey = JSON.stringify(urls ?? []);
  const list = useMemo<string[]>(() => JSON.parse(listKey), [listKey]);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  useLayoutEffect(() => {
    setResolved({});
    setLightbox(null);
  }, [supabaseClient, profile?.id, mode, list]);

  useEffect(() => {
    let active = true;
    (async () => {
      const entries: [string, string | null][] = [];
      for (const u of list) {
        entries.push([u, await resolveEvidenceUrl(u, profile ? supabaseClient : null)]);
      }
      if (active && entries.length > 0) {
        setResolved(Object.fromEntries(entries));
      }
    })();
    return () => {
      active = false;
    };
  }, [list, supabaseClient, profile?.id, mode]);

  if (list.length === 0) return null;

  if (size === 'thumb' && list.length > 0) {
    const first = list[0]!;
    const src = resolved[first];
    if (src === null) {
      return <UnavailableEvidence className={className} />;
    }
    return (
      <>
      <button
        type="button"
        onClick={() => src && setLightbox(src)}
        className={`relative inline-block ${className ?? ''}`}
        aria-label={`View ${list.length} evidence photo(s)`}
      >
        {src ? (
          <img
            src={src}
            alt="Evidence"
            className="h-12 w-12 rounded-lg object-cover ring-1 ring-line"
            onError={() =>
              setResolved((current) => ({ ...current, [first]: null }))
            }
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
      </button>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      </>
    );
  }

  return (
    <div className={className}>
      <ul className="grid grid-cols-4 gap-2" aria-label="Evidence photos">
        {list.map((u, index) => {
          const src = resolved[u] ?? undefined;
          return (
            <li key={`${u}-${index}`}>
              {resolved[u] === null ? (
                <UnavailableEvidence />
              ) : (
                <button
                  type="button"
                  onClick={() => src && setLightbox(src)}
                  className="block w-full"
                  aria-label="View evidence photo"
                >
                  {src ? (
                    <img
                      src={src}
                      alt="Evidence"
                      className="aspect-square w-full rounded-xl object-cover ring-1 ring-line"
                      onError={() =>
                        setResolved((current) => ({ ...current, [u]: null }))
                      }
                    />
                  ) : (
                    <span className="grid aspect-square w-full place-items-center rounded-xl bg-inset text-faint ring-1 ring-line">
                      <Icon name="camera" className="h-5 w-5" />
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function UnavailableEvidence({ className }: { className?: string }) {
  return (
    <span
      role="alert"
      className={`inline-flex min-h-12 items-center gap-2 rounded-lg bg-amber-50 px-3 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-800 ${className ?? ''}`}
    >
      <Icon name="alert" className="h-4 w-4 shrink-0" />
      Evidence unavailable
    </span>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  // Join Sheet's modal stack so the preview owns pointer events and focus.
  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Evidence photo"
      initialFocusRef={closeButton}
      showClose={false}
      overlayClassName="!z-[60] !bg-black/80 !backdrop-blur-none"
      className="!inset-0 !z-[60] !h-full !max-h-none !w-full !translate-x-0 !translate-y-0 !overflow-hidden !rounded-none !border-0 !bg-transparent !shadow-none grid place-items-center p-4"
    >
      <div
        aria-hidden="true"
        data-testid="evidence-lightbox-backdrop"
        className="absolute inset-0"
        onClick={onClose}
      />
      <button
        ref={closeButton}
        type="button"
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white"
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
      <img
        src={src}
        alt="Evidence"
        className="relative h-auto w-auto max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded-2xl object-contain supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]"
      />
    </Modal>
  );
}
