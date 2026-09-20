import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifest } from './sep20-event-live-manifest.mjs';
import { productsFor, assertProductSetup } from './sep21-event-products.mjs';
const m=createManifest({runId:'13ec2166-93be-4902-b323-bacc857dad5d',date:'2026-09-21',commit:'9ec7311f9062c2c185682db21a5f9bddc7b72943',origin:'https://mwell-intra-uat.vercel.app'});
const env={APP_ENV:'uat',AUDIT_MUTATIONS:'true',AUDIT_PASSWORD:'not-logged',SEP20_EVENT_LIVE_APPROVED:m.runId};
test('new approved event gets exactly two run-owned product definitions and no stock fields',()=>{
  const rows=productsFor(m);
  assert.deepEqual(rows.map(r=>r.id),m.lines.map(l=>l.productId));
  assert.deepEqual(rows.map(r=>r.serialization_policy),['required','none']);
  assert(rows.every(r=>r.unit_cost===0&&r.attributes.synthetic&&r.attributes.sep20_event_run===m.runId));
  assert(rows.every(r=>!('quantity' in r)&&!('serial_numbers' in r)&&r.sku.includes('SEP21')));
});
test('product setup requires the exact approved run, date, live SHA and UAT origin',()=>{
  assertProductSetup(m,env,'2026-09-21');
  for(const patch of [{date:'2026-09-20'},{runId:'12345678-1234-4234-8234-123456789abc'},{commit:'a'.repeat(40)},{origin:'https://other.vercel.app'}])
    assert.throws(()=>assertProductSetup(createManifest({...m,...patch}),env,'2026-09-21'));
  assert.throws(()=>assertProductSetup(m,env,'2026-09-22'));
  for(const key of Object.keys(env)){const bad={...env};delete bad[key];assert.throws(()=>assertProductSetup(m,bad,'2026-09-21'));}
});
