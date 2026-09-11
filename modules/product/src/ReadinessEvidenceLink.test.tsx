import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadinessEvidenceLink } from './ReadinessEvidenceLink';

afterEach(() => vi.unstubAllGlobals());
it.each(['javascript:alert(1)', 'https://example.test/file.pdf', 'KIT-APR-1'])('UX10 keeps unsupported reference %s legible without bypassing governed access', reference => {
  render(<ReadinessEvidenceLink reference={reference} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText(/Reference only/)).toBeInTheDocument();
});
it('UX10 requests governed access and keeps a persistent denied error with retry', async () => {
  const reference = 'evidence://12345678-1234-1234-1234-123456789abc';
  const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Denied' }) });
  vi.stubGlobal('fetch', fetcher);
  render(<ReadinessEvidenceLink reference={reference} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open governed evidence' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Evidence access unavailable');
  expect(fetcher).toHaveBeenCalledWith('/api/evidence', expect.objectContaining({ body: JSON.stringify({ action: 'open', reference }) }));
  expect(screen.getByRole('button', { name: 'Open governed evidence' })).toBeEnabled();
});
