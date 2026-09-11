import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'A', load: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { id: state.actor }, mode: 'live', supabaseClient: null }) }));
vi.mock('@/app/store', () => ({ useWarehouse: () => ({ loadQualityInspectionEvidence: state.load }) }));
vi.mock('@/components/EvidenceGallery', () => ({ EvidenceGallery: ({ urls }: { urls: string[] }) => <div aria-label="Exact photos">{urls.join(',')}</div> }));
import { InspectionEvidence, INSPECTION_PHOTO_TIMEOUT_MS } from './InspectionEvidence';
let intersect: (entries: { isIntersecting: boolean }[]) => void;
describe('Inspection evidence loading', () => {
  beforeEach(() => {
    state.actor = 'A'; state.load.mockReset(); state.load.mockResolvedValue(['exact.png']);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {} disconnect() {}
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('does not fetch offscreen photos and loads the exact visible record once', async () => {
    const view = render(<InspectionEvidence inspectionId="inspection-A" evidenceCount={2} />);
    expect(state.load).not.toHaveBeenCalled();
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(state.load).toHaveBeenCalledWith('inspection-A');
    expect(screen.getByLabelText('Exact photos')).toHaveTextContent('exact.png');
    view.rerender(<InspectionEvidence inspectionId="inspection-A" evidenceCount={2} />);
    expect(state.load).toHaveBeenCalledTimes(1);
  });
  it('does not fetch inspections without evidence', () => {
    render(<InspectionEvidence inspectionId="empty" evidenceCount={0} />);
    expect(state.load).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('keeps failed photos visible as a retryable error, not missing evidence', async () => {
    state.load.mockRejectedValueOnce(new Error('offline'));
    render(<InspectionEvidence inspectionId="retry" evidenceCount={1} />);
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(screen.getByRole('alert')).toHaveTextContent('Photos could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Retry photos' }));
    expect(await screen.findByLabelText('Exact photos')).toHaveTextContent('exact.png');
    expect(state.load).toHaveBeenCalledTimes(2);
  });
  it('discards a late response from a different identity', async () => {
    let resolve!: (urls: string[]) => void;
    state.load.mockReturnValueOnce(new Promise<string[]>(done => { resolve = done; }));
    const view = render(<InspectionEvidence inspectionId="same" evidenceCount={1} />);
    await act(async () => intersect([{ isIntersecting: true }]));
    state.actor = 'B'; state.load.mockResolvedValue(['actor-B.png']);
    view.rerender(<InspectionEvidence inspectionId="same" evidenceCount={1} />);
    expect(await screen.findByLabelText('Exact photos')).toHaveTextContent('actor-B.png');
    await act(async () => resolve(['actor-A-secret.png']));
    expect(screen.getByLabelText('Exact photos')).not.toHaveTextContent('actor-A-secret');
  });
  it('does not treat a now-empty evidence response as successfully displayed', async () => {
    state.load.mockResolvedValue([]);
    render(<InspectionEvidence inspectionId="changed" evidenceCount={1} />);
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(screen.getByRole('alert')).toHaveTextContent('Reload the quality queue');
  });
  it('times out a stuck photo read and ignores its late response after retry', async () => {
    vi.useFakeTimers();
    let resolve!: (urls: string[]) => void;
    state.load.mockReturnValueOnce(new Promise<string[]>(done => { resolve = done; }));
    render(<InspectionEvidence inspectionId="slow" evidenceCount={1} />);
    await act(async () => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTimeAsync(INSPECTION_PHOTO_TIMEOUT_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('taking too long');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry photos' })));
    expect(screen.getByLabelText('Exact photos')).toHaveTextContent('exact.png');
    await act(async () => resolve(['outdated.png']));
    expect(screen.getByLabelText('Exact photos')).not.toHaveTextContent('outdated');
  });
});
