import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceCapture } from './EvidenceCapture';
import { EvidenceGallery } from '../EvidenceGallery';
import { InspectionSheet } from '../quality/InspectionSheet';
import { renderWithProviders } from '@/test/renderWithProviders';

const state = vi.hoisted(() => {
  const upload = vi.fn();
  const sign = vi.fn();
  const client = { storage: { from: vi.fn(() => ({ upload, createSignedUrl: sign })) } };
  return { upload, sign, client, mode: 'supabase', actor: 'actor-A', available: true };
});
vi.mock('@intra/auth', async (original) => ({
  ...await original<typeof import('@intra/auth')>(),
  useSession: () => ({ mode: state.mode, supabaseClient: state.available ? state.client : null, profile: { id: state.actor }, userRoles: {} }),
}));

const photo = () => new File(['photo'], 'proof.png', { type: 'image/png' });
const input = () => screen.getByLabelText('Capture photo evidence', { selector: 'input' });

describe('authenticated evidence transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mode = 'supabase'; state.actor = 'actor-A'; state.available = true;
    state.upload.mockResolvedValue({ data: {}, error: null });
    state.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed.png' }, error: null });
  });
  it('uploads through the injected client without environment configuration and persists a path', async () => {
    const change = vi.fn();
    render(<EvidenceCapture reference="inspection/target" onChange={change} />);
    await userEvent.upload(input(), photo());
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    expect(change.mock.calls[0]![0][0]).toMatch(/^inspection\/target\/0\/[\w-]+\.png$/);
    expect(state.upload).toHaveBeenCalledWith(expect.any(String), expect.any(Uint8Array), { contentType: 'image/png', upsert: false });
    await waitFor(() => expect(state.sign).toHaveBeenCalled());
  });
  it('fails closed without a session client and can retry the same file after recovery', async () => {
    state.available = false;
    const change = vi.fn();
    const view = render(<EvidenceCapture onChange={change} />);
    const file = photo();
    await userEvent.upload(input(), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('Authenticated evidence storage is unavailable');
    expect(change).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
    state.available = true;
    view.rerender(<EvidenceCapture onChange={change} />);
    await userEvent.upload(input(), file);
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
  });
  it('keeps memory explicit even with a configured client', async () => {
    state.mode = 'memory';
    const change = vi.fn();
    render(<EvidenceCapture onChange={change} />);
    await userEvent.upload(input(), photo());
    await waitFor(() => expect(change).toHaveBeenCalledWith([expect.stringMatching(/^data:image\/png;base64,/)]));
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('ignores an upload completed after an actor change', async () => {
    let finish!: (value: unknown) => void;
    state.upload.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const change = vi.fn();
    const view = render(<EvidenceCapture onChange={change} />);
    await userEvent.upload(input(), photo());
    await waitFor(() => expect(state.upload).toHaveBeenCalledOnce());
    state.actor = 'actor-B';
    view.rerender(<EvidenceCapture onChange={change} />);
    await act(async () => finish({ data: {}, error: null }));
    expect(change).not.toHaveBeenCalled();
  });
  it('signs stored paths in the gallery and clears stale actor results', async () => {
    let finish!: (value: unknown) => void;
    state.sign.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<EvidenceGallery urls={['evidence/inspection/photo.png']} />);
    await waitFor(() => expect(state.sign).toHaveBeenCalledWith('inspection/photo.png', 3600));
    state.actor = 'actor-B';
    state.sign.mockResolvedValue({ data: null, error: { message: 'Denied' } });
    view.rerender(<EvidenceGallery urls={['evidence/inspection/photo.png']} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence unavailable');
    await act(async () => finish({ data: { signedUrl: 'https://storage.example/old-actor.png' }, error: null }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('blocks inspection after storage denial until a real upload retry succeeds', async () => {
    state.upload.mockResolvedValueOnce({ data: null, error: { message: 'Storage policy denied' } });
    const submit = vi.fn().mockResolvedValue(true);
    renderWithProviders(<InspectionSheet target={{ sourceType: 'receipt', sourceId: 'receipt-A', productId: 'shirt-l', productName: 'Shirt', quantity: 1 }} requiresEvidence onSubmit={submit} onOpenChange={() => undefined} />);
    const fileInput = screen.getByLabelText('Attach inspection evidence', { selector: 'input' });
    await userEvent.upload(fileInput, photo());
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage policy denied');
    expect(screen.getByRole('button', { name: 'Submit inspection' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.upload(fileInput, photo());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit inspection' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Submit inspection' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ evidenceUrls: [expect.not.stringMatching(/^data:/)] }));
  });
});
