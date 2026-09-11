import { describe, expect, it } from 'vitest';
import { userFacingError } from './userFacingError';

describe('plain-language error messages', () => {
  it.each([
    ['A governed receipt decision already reserves this procurement PO line', 'Warehouse Supervisor'],
    ['Pending independent inspection holds cannot be released directly', 'Quality Control'],
    ['The receiving Operator cannot approve their own exception, including through delegation', 'another authorized'],
    ['The releasing operator cannot acknowledge receipt', 'recipient'],
    ['Expected quantity drift: locked PO-line remaining quantity is 12, caller supplied 13', 'quantity has changed'],
    ['Idempotency key was reused with a different payload', 'record history'],
    ['Failed to fetch', 'cannot confirm'],
    ['JWT expired', 'Sign in again'],
    ['Invalid login credentials', 'email or password'],
    ['new row violates row-level security policy for table receipts', 'access'],
    ['column doa_assignments.created_at does not exist', 'support team'],
    ['duplicate key value violates unique constraint receipt_serial_key', 'already exist'],
    ['update violates foreign key constraint orders_product_id_fkey', 'linked record'],
    ['Could not find the function warehouse.receive(jsonb) in the schema cache', 'support team'],
    ['Request rate limit reached', 'Wait a moment'],
    ['Payload too large', 'smaller file'],
    ['Failed to load resource: the server responded with a status of 500', 'cannot confirm'],
    ['A second warehouse operator must release the prepared order', 'different warehouse operator'],
    ['Finance evidence is required for refunds and write-offs', 'Finance'],
    ['A quarantine bin is required before any return resolution', 'return'],
    ['Not authorized: warehouse.release_quality_hold', 'administrator'],
    ['Held serialized inventory cannot be transferred.', 'Quality Control'],
    ['Invalid page cursor.', 'Reopen the list'],
    ['Return quantity exceeds outstanding allocation custody', 'previous returns'],
    ['Authentication is required for receiving drafts', 'Sign in again'],
    ['Reservation not confirmed. Recover the original reservation before starting another. Connection lost', 'Recover reservation'],
    ['Evidence upload failed: Storage policy denied upload', 'administrator'],
  ])('explains %s', (raw, expected) => {
    expect(userFacingError(raw)).toContain(expected);
    expect(userFacingError(userFacingError(raw))).toBe(userFacingError(raw));
  });

  it('keeps useful field guidance and exact item references', () => {
    expect(userFacingError('Scan MW-PWR-0002 from bin A-01.')).toBe('Scan MW-PWR-0002 from bin A-01.');
    expect(userFacingError('Enter the actual delivery date.')).toBe('Enter the actual delivery date.');
    expect(userFacingError('Scan MW-413 or choose bin 429.')).toBe('Scan MW-413 or choose bin 429.');
    expect(userFacingError('Evidence upload failed: Choose a PNG image.')).toBe('Evidence upload failed: Choose a PNG image.');
    expect(userFacingError('Receipt succeeded, but saved progress could not be updated.')).toContain('Receipt succeeded');
  });

  it('supports native errors and API error objects without exposing internals', () => {
    expect(userFacingError(new Error('JWT expired'))).toContain('Sign in again');
    expect(userFacingError({ code: '42501', message: 'permission denied for schema private', details: 'secret' })).not.toContain('private');
    expect(userFacingError({ code: 'PGRST202' })).toContain('support team');
    expect(userFacingError(null)).toContain('cannot confirm');
    expect(userFacingError({})).not.toContain('[object Object]');
  });

  it('does not claim a failed network request means nothing was saved', () => {
    const result = userFacingError('NetworkError when attempting to fetch resource');
    expect(result).toContain('before submitting again');
    expect(result).not.toMatch(/nothing was saved|no changes were saved/i);
  });

  it('keeps recovery specific to login and unavailable draft storage', () => {
    expect(userFacingError('Failed to fetch', 'sign-in')).toContain('try Sign in again');
    expect(userFacingError('Failed to fetch', 'sign-in')).not.toContain('record history');
    const draft = userFacingError('Reservation not confirmed. Storage unavailable');
    expect(draft).toContain('draft could not be saved');
    expect(draft).not.toContain('Recover reservation');
  });

  it('does not print server paths, SQL details or token-bearing URLs', () => {
    for (const raw of ['Internal Server Error at C:\\server\\secret.ts:22', 'Upload failed https://example.test/file?token=private-value', 'PGRST202: private.internal_function']) {
      expect(userFacingError(raw)).not.toMatch(/secret\.ts|private-value|private\.internal/);
    }
  });
});
