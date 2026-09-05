import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
  it('keeps a batch session alive across rejected codes and uses the latest callback', async () => {
    let emit!: (code: string) => void;
    const engine: ScanEngine = { start: vi.fn(async (_video, callback) => { emit = callback; }), stop: vi.fn() };
    const first = vi.fn();
    const latest = vi.fn();
    const user = userEvent.setup();
    const view = render(<BarcodeScanner mode="batch" onDetected={first} engineFactory={() => engine} />);
    await user.click(screen.getByRole('button', { name: /scan barcode/i }));
    act(() => { emit('VALID-1'); emit('VALID-1'); });
    expect(first).toHaveBeenCalledOnce();
    view.rerender(<BarcodeScanner mode="batch" onDetected={latest} engineFactory={() => engine} />);
    act(() => { emit('INVALID'); emit('VALID-2'); });
    expect(latest.mock.calls).toEqual([['INVALID'], ['VALID-2']]);
    expect(engine.start).toHaveBeenCalledOnce();
    expect(engine.stop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible();
    view.rerender(<BarcodeScanner mode="batch" disabled onDetected={latest} engineFactory={() => engine} />);
    expect(engine.stop).toHaveBeenCalledOnce();
    act(() => emit('LATE'));
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it('cleans up a stream acquired after unmount and ignores late results', async () => {
    let finish!: () => void;
    let emit!: (code: string) => void;
    const engine: ScanEngine = { start: vi.fn((_video, callback) => { emit = callback; return new Promise<void>((resolve) => { finish = resolve; }); }), stop: vi.fn() };
    const onDetected = vi.fn();
    const user = userEvent.setup();
    const view = render(<BarcodeScanner mode="batch" onDetected={onDetected} engineFactory={() => engine} />);
    await user.click(screen.getByRole('button', { name: /scan barcode/i }));
    view.unmount();
    await act(async () => { emit('LATE'); finish(); });
    expect(onDetected).not.toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalledTimes(2);
  });
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

  it('disables empty manual submission so the control cannot fail silently', () => {
    const onDetected = vi.fn();
    render(<BarcodeScanner onDetected={onDetected} engineFactory={fakeEngine} />);
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
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
