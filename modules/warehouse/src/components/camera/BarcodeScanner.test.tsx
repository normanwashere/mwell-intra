import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { BarcodeScanner } from './BarcodeScanner';
import type { ScanEngine } from './scanEngine';

function fakeEngine(codeToEmit?: string): ScanEngine {
  return {
    start: vi.fn(async (_video, onResult) => {
      if (codeToEmit) onResult(codeToEmit);
    }),
    stop: vi.fn(),
  };
}

describe('BarcodeScanner', () => {
  it('emits a manually entered barcode', async () => {
    const onDetected = vi.fn();
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={onDetected} engineFactory={fakeEngine} />);

    await user.type(
      screen.getByLabelText(/enter barcode manually/i),
      '4800010001',
    );
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onDetected).toHaveBeenCalledWith('4800010001');
  });

  it('does not emit empty manual input', async () => {
    const onDetected = vi.fn();
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={onDetected} engineFactory={fakeEngine} />);
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('starts the engine and emits a detected code from the camera', async () => {
    const onDetected = vi.fn();
    const engine = fakeEngine('SCANNED-123');
    const user = userEvent.setup();
    render(
      <BarcodeScanner onDetected={onDetected} engineFactory={() => engine} />,
    );

    await user.click(screen.getByRole('button', { name: /scan barcode/i }));

    expect(engine.start).toHaveBeenCalled();
    expect(onDetected).toHaveBeenCalledWith('SCANNED-123');
    expect(engine.stop).toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <BarcodeScanner onDetected={vi.fn()} engineFactory={fakeEngine} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the manual fallback when the camera engine rejects', async () => {
    const user = userEvent.setup();
    const engine: ScanEngine = { start: vi.fn().mockRejectedValue(new Error('denied')), stop: vi.fn() };
    render(<BarcodeScanner onDetected={vi.fn()} engineFactory={() => engine} />);
    await user.click(screen.getByRole('button', { name: /scan barcode/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera access/i);
    expect(screen.getByLabelText(/enter barcode manually/i)).toBeInTheDocument();
  });

  it('emits only the first result when the camera reports twice rapidly', async () => {
    const onDetected = vi.fn();
    const engine: ScanEngine = {
      start: vi.fn(async (_video, onResult) => {
        onResult('FIRST');
        onResult('SECOND');
      }),
      stop: vi.fn(),
    };
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={onDetected} engineFactory={() => engine} />);
    await user.click(screen.getByRole('button', { name: /scan barcode/i }));
    expect(onDetected).toHaveBeenCalledOnce();
    expect(onDetected).toHaveBeenCalledWith('FIRST');
  });

  it('keeps manual task capture available while offline', async () => {
    const onDetected = vi.fn();
    const user = userEvent.setup();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    render(<BarcodeScanner onDetected={onDetected} engineFactory={fakeEngine} />);
    await user.type(screen.getByLabelText(/enter barcode manually/i), 'OFFLINE-001');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onDetected).toHaveBeenCalledWith('OFFLINE-001');
    vi.restoreAllMocks();
  });
});
