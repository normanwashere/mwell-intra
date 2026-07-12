import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportsPage } from './ImportsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

const csv = new File(['template_version,location_external_id\n1,loc-1'], 'locations.csv', { type: 'text/csv' });

describe('ImportsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts drop input, reconciles preview counts, and keeps Apply away from unresolved errors', async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job: { id: 'job-invalid', status: 'invalid', source_rows: 5, accepted_rows: 3, rejected_rows: 1, duplicate_rows: 1 },
      issues: [{ row: 4, field: 'bin_code', code: 'duplicate', message: 'Duplicate bin.' }],
      preview: { sourceRows: 5, acceptedRows: 3, rejectedRows: 1, duplicateRows: 1, normalizedRows: [] },
      evidence: { checksumSha256: 'abc123', sourceFile: 'locations.csv', uploaderEmail: 'admin@mwell.test' },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ImportsPage />, { role: 'warehouse_admin', source: 'supabase' });

    fireEvent.drop(screen.getByLabelText('Import CSV drop zone'), { dataTransfer: { files: [csv] } });
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    const preview = await screen.findByLabelText('Import reconciliation');
    expect(within(preview).getByText('5')).toBeInTheDocument();
    expect(within(preview).getByText('3')).toBeInTheDocument();
    expect(within(preview).getAllByText('1')).toHaveLength(2);
    expect(screen.getByText(/5 = 3 \+ 1 \+ 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download error CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply import' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start correction' }));
    expect(screen.getByText(/correction of job-invalid/i)).toBeInTheDocument();
  });

  it('shows evidence and requires a separate reviewer before applying a valid file', async () => {
    const user = userEvent.setup();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        job: { id: 'job-ready', status: 'ready', source_rows: 2, accepted_rows: 2, rejected_rows: 0, duplicate_rows: 0 },
        issues: [],
        preview: { sourceRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0, normalizedRows: [] },
        evidence: { checksumSha256: 'f'.repeat(64), sourceFile: 'locations.csv', uploaderEmail: 'uploader@mwell.test' },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'applied', reviewer_email: 'reviewer@mwell.test' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ImportsPage />, { role: 'warehouse_admin', source: 'supabase' });

    await user.upload(screen.getByLabelText('Choose import CSV'), csv);
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    expect(await screen.findByText(/uploader@mwell.test/)).toBeInTheDocument();
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText(/different warehouse administrator must review/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply import' }));
    expect(await screen.findByText(/import applied/i)).toBeInTheDocument();
    expect(screen.getByText(/reviewer@mwell.test/)).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith('/api/warehouse/imports', expect.objectContaining({ method: 'POST' }));
  });

  it('blocks validation while offline', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithProviders(<ImportsPage />, { role: 'warehouse_admin', source: 'supabase' });
    expect(screen.getByText(/connect to the network/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate file' })).toBeDisabled();
    online.mockRestore();
  });

  it('lets a separate administrator reopen a ready job from the review queue', async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobs: [{
        id: 'job-from-uploader', status: 'ready', source_rows: 4, accepted_rows: 4,
        rejected_rows: 0, duplicate_rows: 0, filename: 'opening.csv',
        checksum_sha256: 'a'.repeat(64), created_by: 'different-profile',
        created_by_email: 'other.admin@mwell.test', corrected_from: null,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ImportsPage />, { role: 'warehouse_admin', source: 'supabase' });

    await user.click(screen.getByRole('button', { name: 'Load review queue' }));
    const queue = await screen.findByLabelText('Import review queue');
    await user.click(within(queue).getByRole('button', { name: 'Review job' }));
    expect(screen.getAllByText(/other.admin@mwell.test/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeInTheDocument();
  });
});
