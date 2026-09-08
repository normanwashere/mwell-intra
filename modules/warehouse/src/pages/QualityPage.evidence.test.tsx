import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualityPage } from './QualityPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { resolveEvidenceUrl } from '@/data/supabase/evidence';

vi.mock('@/data/supabase/evidence', () => ({
  resolveEvidenceUrl: vi.fn(async (path: string) => `https://example.test/signed/${path}`),
}));

describe('Completed inspection evidence', () => {
  it('opens the exact persisted inspection photo after remount, not another or pending inspection', async () => {
    const repo = makeRepo();
    const base = { sourceType: 'receipt' as const, sourceId: 'receipt-long-source-001', productId: 'shirt-l', quantity: 2, inspectedAt: '2026-09-08T03:00:00Z', inspectedBy: 'quality-reviewer' };
    vi.spyOn(repo, 'listQualityInspections').mockResolvedValue({ rows: [
      { ...base, id: 'qc-accepted', disposition: 'accepted', evidenceUrls: ['quality/accepted.png'] },
      { ...base, id: 'qc-other', sourceId: 'receipt-other', disposition: 'hold', evidenceUrls: ['quality/other.png'] },
      { ...base, id: 'qc-pending', sourceId: 'receipt-pending', disposition: 'pending', evidenceUrls: ['quality/pending.png'] },
    ] });
    const user = userEvent.setup();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const view = renderWithProviders(<QualityPage />, { repo, route: '/quality?inspection=qc-accepted' });
      const list = await screen.findByRole('list', { name: 'Completed inspections' });
      const row = within(list).getByRole('listitem', { name: 'Inspection qc-accepted' });
      expect(within(row).getByText('receipt: receipt-long-source-001')).toHaveClass('break-all');
      expect(within(row).getByText('2026-09-08')).toHaveAttribute('datetime', base.inspectedAt);
      expect(row).toHaveClass('min-w-0', 'sm:grid-cols-[minmax(0,1fr)_auto]');
      const thumbnail = await within(row).findByRole('img', { name: 'Evidence' });
      expect(thumbnail).toHaveAttribute('src', 'https://example.test/signed/quality/accepted.png');
      await user.click(within(row).getByRole('button', { name: 'View 1 evidence photo(s)' }));
      const lightbox = await screen.findByRole('dialog', { name: 'Evidence photo' });
      expect(within(lightbox).getByRole('img', { name: 'Evidence' })).toHaveAttribute('src', 'https://example.test/signed/quality/accepted.png');
      expect(resolveEvidenceUrl).toHaveBeenCalledWith('quality/accepted.png', null);
      expect(vi.mocked(resolveEvidenceUrl).mock.calls.some(([path]) => path === 'quality/pending.png')).toBe(false);
      expect(within(list).queryByRole('listitem', { name: 'Inspection qc-pending' })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
