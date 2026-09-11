import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
import { useWarehouse } from '@/app/store';
import { EvidenceGallery } from '@/components/EvidenceGallery';

export const INSPECTION_PHOTO_TIMEOUT_MS = 12_000;

export function InspectionEvidence({ inspectionId, evidenceCount }: { inspectionId: string; evidenceCount: number }) {
  const { loadQualityInspectionEvidence } = useWarehouse();
  const { profile, mode, supabaseClient } = useSession();
  const target = useRef<HTMLDivElement>(null);
  const loader = useRef(loadQualityInspectionEvidence);
  loader.current = loadQualityInspectionEvidence;
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [urls, setUrls] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => { setUrls(null); setError(null); }, [inspectionId, profile?.id, mode, supabaseClient]);
  useEffect(() => {
    if (!target.current || evidenceCount === 0) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [evidenceCount]);
  useEffect(() => {
    if (!visible || evidenceCount === 0) return;
    let active = true;
    setError(null);
    setUrls(null);
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      setError('Photos are taking too long to load. Please retry.');
    }, INSPECTION_PHOTO_TIMEOUT_MS);
    void loader.current(inspectionId).then(value => {
      if (!active) return;
      clearTimeout(timer);
      if (!value.length) { setError('Photos are no longer available. Reload the quality queue.'); return; }
      setUrls(value);
    }, () => { clearTimeout(timer); if (active) setError('Photos could not load.'); });
    return () => { active = false; clearTimeout(timer); };
  }, [visible, inspectionId, evidenceCount, attempt, profile?.id, mode, supabaseClient]);

  if (evidenceCount === 0) return null;
  return <div ref={target} className="min-h-12 min-w-12 shrink-0">
    {urls ? <EvidenceGallery urls={urls} size="thumb" /> : error ? <div role="alert" className="max-w-48 text-sm text-red-700 dark:text-red-300">
      <p>{error}</p><button type="button" className="min-h-11 underline" onClick={() => setAttempt(value => value + 1)}>Retry photos</button>
    </div> : <span role="status" className="flex h-12 items-center text-xs text-muted-foreground">{visible ? 'Loading photos...' : `${evidenceCount} photo(s)`}</span>}
  </div>;
}
