// Barcode scanning engine with a native-first strategy:
//   1. Browser `BarcodeDetector` API (fast, no bundle cost) when available.
//   2. `@zxing/browser` as a fallback for iOS Safari / unsupported devices.
//
// The component depends only on the `ScanEngine` interface, so tests can inject
// a fake engine and exercise the UI without real camera hardware.

export interface ScanEngine {
  start(
    video: HTMLVideoElement,
    onResult: (code: string) => void,
    onError?: (err: unknown) => void,
  ): Promise<void>;
  stop(): void;
}

export function isBarcodeDetectorSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

class NativeEngine implements ScanEngine {
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;

  async start(
    video: HTMLVideoElement,
    onResult: (code: string) => void,
    onError?: (err: unknown) => void,
  ): Promise<void> {
    try {
      const Ctor = (window as unknown as {
        BarcodeDetector: new (opts?: unknown) => BarcodeDetectorLike;
      }).BarcodeDetector;
      const detector = new Ctor({
        formats: [
          'qr_code',
          'ean_13',
          'ean_8',
          'code_128',
          'code_39',
          'upc_a',
          'upc_e',
          'itf',
        ],
      });
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      video.srcObject = this.stream;
      await video.play();
      this.running = true;

      const tick = async () => {
        if (!this.running) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            onResult(codes[0]!.rawValue);
          }
        } catch {
          /* transient decode error — keep scanning */
        }
        this.raf = requestAnimationFrame(() => void tick());
      };
      this.raf = requestAnimationFrame(() => void tick());
    } catch (err) {
      onError?.(err);
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

class ZXingEngine implements ScanEngine {
  private controls: { stop: () => void } | null = null;

  async start(
    video: HTMLVideoElement,
    onResult: (code: string) => void,
    onError?: (err: unknown) => void,
  ): Promise<void> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      this.controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result) => {
          if (result) onResult(result.getText());
        },
      );
    } catch (err) {
      onError?.(err);
    }
  }

  stop(): void {
    this.controls?.stop();
    this.controls = null;
  }
}

export function createScanEngine(): ScanEngine {
  return isBarcodeDetectorSupported() ? new NativeEngine() : new ZXingEngine();
}
