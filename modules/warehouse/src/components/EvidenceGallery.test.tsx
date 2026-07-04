import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceGallery } from './EvidenceGallery';

// The evidence module reads Supabase config from import.meta.env. In the test
// environment VITE_SUPABASE_URL is unset, so hasSupabaseConfig() returns false
// and resolveEvidenceUrl treats unknown strings as direct URLs / data URLs.

describe('EvidenceGallery', () => {
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
});
