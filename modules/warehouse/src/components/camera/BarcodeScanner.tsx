import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Icon } from '../Icon';
import { createScanEngine, type ScanEngine } from './scanEngine';

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  /** Injectable for tests / custom engines. */
  engineFactory?: () => ScanEngine;
  label?: string;
  manualLabel?: string;
  manualActionLabel?: string;
}

/**
 * Camera barcode scanner with a guaranteed manual-entry fallback so the flow is
 * usable on every device (and testable without camera hardware).
 */
export function BarcodeScanner({
  onDetected,
  engineFactory = createScanEngine,
  label = 'Scan barcode',
  manualLabel = 'Enter barcode manually',
  manualActionLabel = 'Add',
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<ScanEngine | null>(null);
  const handledRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => engineRef.current?.stop();
  }, []);

  const start = async () => {
    setError(null);
    handledRef.current = false;
    const engine = engineFactory();
    engineRef.current = engine;
    setScanning(true);
    try {
      await engine.start(
        videoRef.current as HTMLVideoElement,
        (code) => {
          // Guard against the engine firing multiple results before stop().
          if (handledRef.current) return;
          handledRef.current = true;
          onDetected(code);
          stop();
        },
        () => {
          setError(
            'Scanning needs camera access. Allow the camera in your browser settings, or type the code manually below.',
          );
          setScanning(false);
        },
      );
    } catch {
      setError(
        'Scanning needs camera access. Allow the camera in your browser settings, or type the code manually below.',
      );
      stop();
    }
  };

  const stop = () => {
    engineRef.current?.stop();
    engineRef.current = null;
    setScanning(false);
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    onDetected(code);
    setManual('');
  };

  return (
    <div className="space-y-3">
      {/* Keep the <video> mounted (so the ref is stable for the engine) but
          collapse the viewport while idle to avoid a large empty box. */}
      <div
        className={clsx(
          'relative overflow-hidden rounded-2xl bg-slate-900',
          !scanning && 'hidden',
        )}
      >
        <video
          ref={videoRef}
          className="mx-auto aspect-[4/3] w-full max-w-md object-cover"
          muted
          playsInline
          data-testid="scanner-video"
        />
        {scanning && (
          <>
            <div
              className="pointer-events-none absolute inset-8 rounded-xl border-2 border-accent/80"
              aria-hidden="true"
            />
            <button
              type="button"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 btn-ghost"
              onClick={stop}
            >
              Stop
            </button>
          </>
        )}
      </div>

      {!scanning && (
        <button type="button" className="btn-accent w-full" onClick={() => void start()}>
          <Icon name="scan" />
          {label}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}

      <form
        onSubmit={submitManual}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
      >
        <input
          className="input min-w-0"
          placeholder="Barcode / serial"
          aria-label={manualLabel}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={!manual.trim()}
        >
          {manualActionLabel}
        </button>
      </form>
    </div>
  );
}
