import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EvidenceGallery } from './EvidenceGallery';

// Explicit memory sessions preserve existing inline and trusted app evidence.
vi.mock('@intra/auth', () => ({ useSession: () => ({ mode: 'memory', supabaseClient: null, profile: null }) }));

describe('EvidenceGallery', () => {
  it.each(['thumb', 'grid'] as const)('does not accept a %s preview click until evidence is resolved', async size => {
    render(<EvidenceGallery urls={['data:image/png;base64,eA==']} size={size} />);
    const button = screen.getByRole('button', { name: /view.*evidence photo/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await screen.findByRole('img', { name: 'Evidence' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
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
      expect(close).toHaveClass('h-11', 'w-11', 'z-10');
      expect(within(dialog).getByRole('img', { name: 'Evidence' })).toHaveClass(
        'max-h-[calc(100vh-2rem)]',
        'supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]',
        'max-w-[calc(100vw-2rem)]',
        'object-contain',
      );
      expect(close).toHaveFocus();
      fireEvent.click(close);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
      fireEvent.click(trigger);
      dialog = await screen.findByRole('dialog', { name: 'Evidence photo' });
      fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
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
    expect(screen.getByRole('list', { name: 'Evidence photos' })).toHaveClass('grid-cols-4');
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

  it.each(['thumb', 'grid'] as const)('keeps external %s evidence as an explicit link without loading third-party images', async size => {
    render(<EvidenceGallery urls={['https://deliverylink.com', 'https://deliverylink.com/OTG-L.png']} size={size} />);
    const links = await screen.findAllByRole('link', { name: /open external evidence/i });
    expect(links[0]).toHaveAttribute('href', 'https://deliverylink.com');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view.*evidence photo/i })).not.toBeInTheDocument();
  });

  it('keeps photos accessible in a mixed external-link gallery', async () => {
    render(<EvidenceGallery urls={['https://deliverylink.com', 'data:image/png;base64,eA==']} />);
    expect(await screen.findByRole('link', { name: /open external evidence/i })).toBeVisible();
    expect(await screen.findByRole('img', { name: 'Evidence' })).toHaveAttribute('src', 'data:image/png;base64,eA==');
    expect(screen.getByRole('list', { name: 'Evidence photos' })).toHaveClass('grid-cols-2', 'sm:grid-cols-4');
  });

  it('shows a visible failure when an app evidence image cannot load', async () => {
    render(<EvidenceGallery urls={['/uat-evidence/missing.jpg']} size="thumb" />);

    const image = await screen.findByRole('img', { name: 'Evidence' });
    fireEvent.error(image);

    expect(await screen.findByRole('alert')).toHaveTextContent(/evidence unavailable/i);
  });
});
