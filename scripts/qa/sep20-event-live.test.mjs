import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createManifest, validateManifest, assertExecutionGate, assertReleaseEvidence, smokeCommands, REQUIRED_MIGRATIONS } from './sep20-event-live-manifest.mjs';
import { assertSellerPreflight } from './sep20-event-live-preflight.mjs';
const make=()=>createManifest({runId:'12345678-1234-4234-8234-123456789abc',date:'2026-09-20',commit:'a'.repeat(40),origin:'https://mwell-intra-uat.vercel.app'});
const hashes=Object.fromEntries(REQUIRED_MIGRATIONS.map(name=>[name,'b'.repeat(64)]));
const release=m=>({runId:m.runId,project:m.project,commit:m.commit,verifiedAt:'2026-09-20T01:00:00Z',verifiedBy:'release-owner',
  evidenceReference:'read-only-catalog.json',fixtureEvidenceReference:'new-products.json',sellerUiEvidenceReference:'actual-seller-ui.json',
    migrations:hashes,installedDefinitionsVerified:true,rawRlsVerified:true,learningPublishedApproved:true,sellerLearningCompleted:true,sellerUiVerified:true,newSyntheticProductsOnly:true});

test('a separately approved new date uses new dated identities without relabelling September 20 evidence',()=>{
  const original=make();
  assert.equal(original.prefix,`sep20-evt-${original.runId}`);
  assert.equal(original.eventName,`Synthetic Sep20 event ${original.runId}`);
  const next=createManifest({...original,date:'2026-09-21'});
  validateManifest(next);
  assert.equal(next.prefix,`uat-evt-20260921-${next.runId}`);
  assert.equal(next.eventName,`Synthetic UAT event 2026-09-21 ${next.runId.slice(0,8)}`);
  assert.notEqual(next.eventId,original.eventId);
  assert(next.lines.every(line=>!original.lines.some(old=>old.productId===line.productId)));
  assert.deepEqual(next.actors,original.actors);
  assert.equal(smokeCommands(next)[0].payload.event.end_date,'2026-09-21');
  assert.equal(smokeCommands(next)[3].payload.required_date,'2026-09-21');
  assert.throws(()=>validateManifest({...next,eventId:original.eventId}));
});

test('seller profile preflight must not select the nonexistent profiles.department_id column',async()=>{
  const source=await readFile(new URL('./sep20-event-live.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\('profiles'\)\.select\('[^']*department_id/);
  assert.match(source,/await assertSellerPreflight\(client,m,login\.data\.user\.id,today\)/);
  assert(source.indexOf('await assertSellerPreflight(')<source.indexOf('for(const step of smokeCommands(m))'));
});

const sellerId='2a629ca1-7bc8-49e8-9c12-a5f3f764114c';
const otherId='22222222-2222-4222-8222-222222222222';
function sellerClient({profile={},scopes,roles,errorTable,ignoreFilters=false}={}){
  const calls=[];
  const data={
    profiles:[{id:sellerId,status:'active',...profile}],
    profile_department_scopes:scopes??[{profile_id:sellerId,department_id:make().departmentId,scope_type:'member',effective_from:'2026-09-20',effective_to:null}],
    user_roles:roles??[{user_id:sellerId,module:'events',role:'seller'}],
  };
  const columns={profiles:['id','email','full_name','title','kind','vendor_id','status','created_at'],
    profile_department_scopes:['profile_id','department_id','scope_type','effective_from','effective_to'],user_roles:['user_id','module','role']};
  const client={schema(schema){assert.equal(schema,'core');return {from(table){
    assert(table in data);const call={table};calls.push(call);
    const result=single=>{
      if(errorTable===table)return {data:null,error:{code:'42501'}};
      if(call.select.some(c=>!columns[table].includes(c)))return {data:null,error:{code:'42703'}};
      const filtered=data[table].filter(row=>ignoreFilters||row[call.column]===call.value);
      const selected=filtered.map(row=>Object.fromEntries(call.select.map(key=>[key,row[key]])));
      return single&&selected.length!==1?{data:null,error:{code:'PGRST116'}}:{data:single?selected[0]:selected,error:null};
    };
    const query={select(value){call.select=value.split(',');return query;},eq(column,value){call.column=column;call.value=value;return query;},
      single(){return Promise.resolve(result(true));},then(resolve,reject){return Promise.resolve(result(false)).then(resolve,reject);}};
    return query;
  }};}};
  return {client,calls};
}

test('preflight reads only real schema columns and scopes every read to the authenticated seller',async()=>{
  const {client,calls}=sellerClient();await assertSellerPreflight(client,make(),sellerId,'2026-09-20');
  assert.deepEqual(calls,[
    {table:'profiles',select:['id','status'],column:'id',value:sellerId},
    {table:'profile_department_scopes',select:['profile_id','department_id','scope_type','effective_from','effective_to'],column:'profile_id',value:sellerId},
    {table:'user_roles',select:['module','role'],column:'user_id',value:sellerId},
  ]);
});

test('membership dates are inclusive and an open-ended current member is accepted',async()=>{
  for(const [effective_from,effective_to] of [['2026-09-20',null],['2026-09-19','2026-09-20'],['2026-09-20','2026-09-20'],['2026-09-20','2026-09-21']]){
    const scopes=[{profile_id:sellerId,department_id:make().departmentId,scope_type:'member',effective_from,effective_to}];
    await assertSellerPreflight(sellerClient({scopes}).client,make(),sellerId,'2026-09-20');
  }
});

test('expired, future, malformed or incomplete memberships fail before event commands',async()=>{
  const valid={profile_id:sellerId,department_id:make().departmentId,scope_type:'member',effective_from:'2026-09-20',effective_to:null};
  for(const patch of [{effective_from:'2026-09-21'},{effective_to:'2026-09-19'},{effective_from:null},{effective_from:'2026-02-30'},
    {effective_from:'2026-9-2'},{effective_to:'2026-02-30'},{effective_to:undefined}]){
    await assert.rejects(assertSellerPreflight(sellerClient({scopes:[{...valid,...patch}]}).client,make(),sellerId,'2026-09-20'));
  }
});

test('wrong department, owner or duplicate scopes cannot satisfy the seller member boundary',async()=>{
  const valid={profile_id:sellerId,department_id:make().departmentId,scope_type:'member',effective_from:'2026-09-20',effective_to:null};
  for(const scopes of [[],[valid,valid],[{...valid,department_id:otherId}],[{...valid,scope_type:'owner'}],
    [{...valid,scope_type:null}],[{...valid,profile_id:otherId}]]){
    await assert.rejects(assertSellerPreflight(sellerClient({scopes,ignoreFilters:true}).client,make(),sellerId,'2026-09-20'));
  }
});

test('inactive or mismatched profiles and extra, absent or foreign roles fail closed',async()=>{
  for(const options of [{profile:{status:'inactive'}},{profile:{id:otherId},ignoreFilters:true},{roles:[]},
    {roles:[{user_id:sellerId,module:'events',role:'admin'}]},
    {roles:[{user_id:sellerId,module:'events',role:'seller'},{user_id:sellerId,module:'core',role:'staff'}]},
    {roles:[{user_id:otherId,module:'events',role:'seller'}]}]){
    await assert.rejects(assertSellerPreflight(sellerClient(options).client,make(),sellerId,'2026-09-20'));
  }
});

test('query errors, missing actor and date drift deny without any mutations',async()=>{
  for(const errorTable of ['profiles','profile_department_scopes','user_roles']){
    await assert.rejects(assertSellerPreflight(sellerClient({errorTable}).client,make(),sellerId,'2026-09-20'),/Request denied/);
  }
  for(const actor of [undefined,'',otherId]){
    await assert.rejects(assertSellerPreflight(sellerClient().client,make(),actor,'2026-09-20'));
  }
  await assert.rejects(assertSellerPreflight(sellerClient().client,make(),sellerId,'2026-09-21'),/Strict Manila event date/);
});
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
