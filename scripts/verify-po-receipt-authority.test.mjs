import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPoReceiptAuthority } from './verify-po-receipt-authority.mjs';

const migrationPath = new URL(
  '../supabase/migrations/20260714175318_single_po_receipt_authority.sql',
  import.meta.url,
);

test('single receipt authority migration removes Procurement mutation and preserves Warehouse authority', async () => {
  const findings = await verifyPoReceiptAuthority(migrationPath);
  assert.deepEqual(findings, []);
});
