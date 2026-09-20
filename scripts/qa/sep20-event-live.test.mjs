import assert from 'node:assert/strict';
import test from 'node:test';
import { createManifest, validateManifest, assertExecutionGate, assertReleaseEvidence, smokeCommands, REQUIRED_MIGRATIONS } from './sep20-event-live-manifest.mjs';
const make=()=>createManifest({runId:'12345678-1234-4234-8234-123456789abc',date:'2026-09-20',commit:'a'.repeat(40),origin:'https://mwell-intra-uat.vercel.app'});
const hashes=Object.fromEntries(REQUIRED_MIGRATIONS.map(name=>[name,'b'.repeat(64)]));
const release=m=>({runId:m.runId,project:m.project,commit:m.commit,verifiedAt:'2026-09-20T01:00:00Z',verifiedBy:'release-owner',
  evidenceReference:'read-only-catalog.json',fixtureEvidenceReference:'new-products.json',sellerUiEvidenceReference:'actual-seller-ui.json',
  migrations:hashes,installedDefinitionsVerified:true,rawRlsVerified:true,learningPublishedApproved:true,sellerLearningCompleted:true,sellerUiVerified:true,newSyntheticProductsOnly:true});
test('offline manifest binds new products and actual Marketing seller with no staff grant',()=>{
  const m=make();validateManifest(m);assert.equal(m.lines.length,2);
  assert.equal(m.actors.seller,'intra.seller.uat.sep20@mwell.com.ph');assert.equal(m.actors.owner,'intra.test.marketing.events@mwell.com.ph');
  assert.equal(m.departmentId,'7e55e54e-86cd-4157-9fdb-7616be83e340');assert.deepEqual(m.sellerRoles,[{module:'events',role:'seller'}]);
});
test('manifest rejects existing item substitutions, duplicate lines and altered authority',()=>{
  for(const change of [m=>m.lines[0].productId='existing-stock',m=>m.lines[0].quantity=4,m=>m.lines.push(m.lines[0]),m=>m.sellerRoles.push({module:'core',role:'staff'}),m=>m.departmentId=null]){
    const m=make();change(m);assert.throws(()=>validateManifest(m));
  }
});
test('execution requires explicit exact-run approval, UAT environment and secure password input',()=>{
  const m=make(),env={APP_ENV:'uat',AUDIT_MUTATIONS:'true',AUDIT_PASSWORD:'not-printed',SEP20_EVENT_LIVE_APPROVED:m.runId};
  assertExecutionGate(m,env);for(const key of Object.keys(env)){const bad={...env};delete bad[key];assert.throws(()=>assertExecutionGate(m,bad));}
  assert.throws(()=>assertExecutionGate(m,{...env,SEP20_EVENT_LIVE_APPROVED:'other'}));
});
test('release gate fails closed on missing UI, learning, raw isolation, migration or fixture proof',()=>{
  const m=make();assertReleaseEvidence(m,release(m),hashes);
  for(const key of ['installedDefinitionsVerified','rawRlsVerified','learningPublishedApproved','sellerLearningCompleted','sellerUiVerified','newSyntheticProductsOnly'])assert.throws(()=>assertReleaseEvidence(m,{...release(m),[key]:false},hashes));
  assert.throws(()=>assertReleaseEvidence(m,{...release(m),migrations:{}},hashes));
  assert.throws(()=>assertReleaseEvidence(m,{...release(m),project:'production'},hashes));
});
test('bounded first smoke has only create/enable/assign/demand, no issue, outcomes or cleanup',()=>{
  const m=make(),commands=smokeCommands(m);
  assert.deepEqual(commands.map(c=>c.name),['create_event','configure_event_custody','configure_event_custody','request_event_fulfillment']);
  assert.deepEqual(commands,smokeCommands(m));assert.deepEqual(commands[3].payload.lines,m.lines);
  assert.equal(commands[2].payload.seller_email,m.actors.seller);
  assert(commands.every(c=>!('actor_id'in c.payload)&&!('seller_id'in c.payload)));
});
