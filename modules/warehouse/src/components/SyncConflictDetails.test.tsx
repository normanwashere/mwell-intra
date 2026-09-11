import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { buildSeed, type OutboxEntry } from '@intra/data-kit';
import { SyncConflictDetails } from './SyncConflictDetails';

const entry: OutboxEntry = {
  id: 'queue-test', method: 'relocate', status: 'conflict', createdAt: '2026-09-11T02:00:00Z',
  input: { productId: 'doctor-token', quantity: 2, fromBinId: 'BIN-A', toBinId: 'BIN-B', serialNumbers: ['MW-001'],
    password: 'do-not-show', customerAddress: 'private-address', lines: [{ productId: 'doctor-token', quantity: 2, secret: 'private-line' }] },
  error: 'Insufficient stock',
};
describe('Read-only sync conflict context', () => {
  it('shows the action, reason, quantities and operational references without exposing the full payload', () => {
    const { container } = render(<SyncConflictDetails entry={entry} data={buildSeed()} />);
    expect(screen.getByText('Move stock between bins')).toBeVisible();
    expect(screen.getByText('Why it needs attention')).toBeVisible();
    expect(screen.getByText('BIN-A')).toBeVisible();
    expect(screen.getByText('BIN-B')).toBeVisible();
    expect(screen.getByText('Selected serials (1)')).toBeVisible();
    expect(container.textContent).not.toMatch(/do-not-show|private-address|private-line|relocate/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('handles unavailable lookups and missing error details without inventing a cause', () => {
    render(<SyncConflictDetails entry={{ ...entry, error: undefined, createdAt: 'invalid' }} data={null} />);
    expect(screen.getByText('Queued date unavailable')).toBeVisible();
    expect(screen.getByText(/Check the current record with your warehouse supervisor/)).toBeVisible();
    expect(screen.getByText('Queue reference: queue-test')).toBeVisible();
  });
});
