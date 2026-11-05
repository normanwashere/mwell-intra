import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('department code constraint accepts its seeded codes without admitting malformed identifiers', async () => {
  const source = readFileSync(new URL('../../supabase/migrations/20260714175057_core_organization_extensibility.sql', import.meta.url), 'utf8');
  const pattern = source.match(/code ~ '([^']+)'/)[1];
  const db = new PGlite();
  try {
    for (const [code, valid] of [['legal_compliance', true], ['people_culture', true], ['operations', true], ['operations.warehouse', true], ['Legal', false], ['.legal', false], ['legal..team', false], ['legal team', false], ['1legal', false], ['', false]]) {
      assert.equal((await db.query('select $1::text ~ $2::text as valid', [code, pattern])).rows[0].valid, valid, code);
    }
  } finally { await db.close(); }
});

for (const filename of ['20260714175318_single_po_receipt_authority.sql', '20260717143000_task3_receipt_authority_forward_convergence.sql']) {
  test(`${filename}: actual qualified PNG expressions parse and retain header validation`, async () => {
    const source = readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8');
    const decode = source.match(/v_signature_bytes:=decode\((pg_catalog\.substring\(v_signature_data[^\n]+\)),'base64'\);/);
    const header = source.match(/or (pg_catalog\.substring\(v_signature_bytes[^\n]+\))\s+is distinct from decode\('89504e470d0a1a0a','hex'\)/);
    assert.ok(decode && header, 'Signature decoding and validation must remain present');
    const db = new PGlite();
    try {
      const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
      const data = `data:image/png;base64,${png.toString('base64')}`;
      const decoded = (await db.query(`select decode(${decode[1].replace('v_signature_data', '$1::text')},'base64') as value`, [data])).rows[0].value;
      assert.deepEqual(Buffer.from(decoded), png);
      const headerSql = `select ${header[1].replace('v_signature_bytes', '$1::bytea')} is distinct from decode('89504e470d0a1a0a','hex') as invalid`;
      for (const [bytes, invalid] of [[png, false], [Buffer.from('not a png'), true], [png.subarray(0, 7), true]]) {
        assert.equal((await db.query(headerSql, [bytes])).rows[0].invalid, invalid);
      }
    } finally { await db.close(); }
  });
}
