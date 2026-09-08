import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EvidenceGallery } from './EvidenceGallery';

// Explicit memory sessions preserve existing inline and trusted app evidence.
vi.mock('@intra/auth', () => ({ useSession: () => ({ mode: 'memory', supabaseClient: null, profile: null }) }));

describe('EvidenceGallery', () => {
  it.each(['thumb', 'grid'] as const)('portals %s lightbox outside buttons, closes with Close/Escape and restores focus without warnings', async (size) => {
    const errors = vi.spyOn(console, 'error');
    try {
      const { container } = render(<EvidenceGallery urls={['data:image/png;base64,eA==']} size={size} />);
      await screen.findByRole('img', { name: 'Evidence' });
      const trigger = screen.getByRole('button', { name: /view.*evidence photo/i });
      trigger.focus();
      fireEvent.click(trigger);
      let dialog = await screen.findByRole('dialog', { name: 'Evidence photo' });
      expect(container).not.toContainElement(dialog);
      expect(dialog.parentElement).toBe(document.body);
      expect(document.querySelector('button button')).toBeNull();
      const close = within(dialog).getByRole('button', { name: 'Close' });
      expect(close).toHaveFocus();
      fireEvent.click(close);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.click(trigger);
      dialog = await screen.findByRole('dialog', { name: 'Evidence photo' });
      fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(errors).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no urls', () => {
    const { container } = render(<EvidenceGallery urls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a data URL thumbnail directly (memory mode)', async () => {
    const dataUrl = 'data:image/png;base64,eA==';
    render(<EvidenceGallery urls={[dataUrl]} />);
    // The data URL passes through resolveEvidenceUrl synchronously.
    expect(await screen.findByRole('button', { name: /view evidence photo/i })).toBeInTheDocument();
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe(dataUrl);
  });

  it('renders a count badge in thumb mode when multiple photos', async () => {
    const a = 'data:image/png;base64,eA==';
    const b = 'data:image/png;base64,eQ==';
    render(<EvidenceGallery urls={[a, b]} size="thumb" />);
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('renders bundled UAT evidence from the trusted app path', async () => {
    const appEvidence = '/uat-evidence/aug24-qc-pending.svg';
    render(<EvidenceGallery urls={[appEvidence]} size="thumb" />);

    expect(await screen.findByRole('img', { name: 'Evidence' })).toHaveAttribute(
      'src',
      appEvidence,
    );
  });

  it('does not issue image requests for unsafe evidence values', async () => {
    render(<EvidenceGallery urls={['http://deliverylink.com/not-evidence']} size="thumb" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/evidence unavailable/i);
    expect(screen.queryByRole('img', { name: 'Evidence' })).not.toBeInTheDocument();
  });

  it('shows a visible failure when safe external evidence cannot load', async () => {
    render(<EvidenceGallery urls={['https://evidence.example/missing.jpg']} size="thumb" />);

    const image = await screen.findByRole('img', { name: 'Evidence' });
    fireEvent.error(image);

    expect(await screen.findByRole('alert')).toHaveTextContent(/evidence unavailable/i);
  });
});
