import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';

export const PROJECT = 'kkoitlvydytdhlpxhuah';
export const REQUIRED_MIGRATIONS = [
  '20260920025455_atomic_quality_batch.sql',
  '20260920025525_gated_event_seller_custody.sql',
  '20260920025920_approved_stock_origin_conversion.sql',
  '20260920030900_event_seller_learning_readiness.sql',
  '20260920080131_gate_warehouse_raw_reads_by_current_capability.sql',
];
const roles = { owner:'marketing_events_lead', operator:'operations_associate', reviewer:'operations_lead', product:'product_owner', finance:'finance_controller' };
const actors = () => ({ ...Object.fromEntries(Object.entries(roles).map(([key,role])=>[key,CURRENT_LIVE_ROLES.find(p=>p.role===role).email])), seller:'intra.seller.uat.sep20@mwell.com.ph' });
export function createManifest({runId=randomUUID(),date,commit,origin}) {
  const prefix=`sep20-evt-${runId}`;
  return { version:1,runId,project:PROJECT,commit,origin,date,prefix,
    scope:'First smoke: new event, explicit custody activation/assignment, one new two-line demand only. NOT procurement, allocation, issue, seller outcome, return, recovery, Finance settlement, UI signoff or full-chain proof.',
    actors:actors(),eventId:`${prefix}-event`,eventName:`Synthetic Sep20 event ${runId}`,
    sourceLocationId:`${prefix}-source`,sourceBinId:`${prefix}-source-bin`,returnLocationId:`${prefix}-returns`,returnBinId:`${prefix}-return-bin`,
    serials:[1,2,3].map(i=>`${prefix.toUpperCase()}-SERIAL-${i}`),
    lines:[{productId:`${prefix}-device`,quantity:3},{productId:`${prefix}-material`,quantity:2}],
    department:'marketing',departmentId:'7e55e54e-86cd-4157-9fdb-7616be83e340',costCenter:'CC-4100',sellerRoles:[{module:'events',role:'seller'}],
    learningRequirement:'internal.role.events.seller.custody-practice.v1',
    fixtureRequirement:'Parent-owned NEW run-tagged products. Demand may show a genuine shortage; no opening stock or serial creation is required or claimed. No runner seed, grant, certification, SMTP or cleanup commands.',
    recoveryPrerequisites:'Separate approved Product kit/version, actual base receipt/QC, packaging, readiness and same-unit forward conversion/return/QC lineage; never infer from this opening inventory.',
  };
}
export function validateManifest(m) {
  assert.equal(m.version,1);assert.equal(m.project,PROJECT);assert.match(m.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(m.commit,/^[a-f0-9]{40}$/);assert.match(m.date,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${m.date}T00:00:00Z`).toISOString().slice(0,10),m.date);
  const url=new URL(m.origin);assert.equal(url.protocol,'https:');assert(url.hostname.endsWith('.vercel.app'));assert.equal(url.origin,m.origin);
  const expected=createManifest(m);
  for(const key of ['prefix','eventId','eventName','sourceLocationId','sourceBinId','returnLocationId','returnBinId','serials','lines','actors','department','departmentId','costCenter','sellerRoles'])assert.deepEqual(m[key],expected[key],`Manifest scope changed: ${key}`);
}
export function assertExecutionGate(m,env) {
  validateManifest(m);assert.equal(env.APP_ENV,'uat');assert.equal(env.AUDIT_MUTATIONS,'true');
  assert.equal(env.SEP20_EVENT_LIVE_APPROVED,m.runId,'Explicit approval must name this exact run');
  assert(env.AUDIT_PASSWORD,'Supply AUDIT_PASSWORD securely; never place it in the manifest');
}
export function assertReleaseEvidence(m,r,hashes) {
  for(const key of ['runId','project','commit'])assert.equal(r[key],m[key],`Release evidence ${key} mismatch`);
  assert(r.verifiedBy&&r.evidenceReference&&r.fixtureEvidenceReference&&r.sellerUiEvidenceReference,'Parent catalog, new-product and actual seller UI evidence required');
  assert(Number.isFinite(Date.parse(r.verifiedAt)),'Verification timestamp required');
  for(const key of ['installedDefinitionsVerified','rawRlsVerified','learningPublishedApproved','sellerLearningCompleted','sellerUiVerified','newSyntheticProductsOnly'])assert.equal(r[key],true,`Missing release gate: ${key}`);
  for(const name of REQUIRED_MIGRATIONS){assert.match(hashes[name]??'',/^[a-f0-9]{64}$/);assert.equal(r.migrations?.[name],hashes[name],`Exact installed migration proof required: ${name}`);}
}
export const keyFor=(m,name)=>`${m.runId}-${name}`;
export function smokeCommands(m) {
  validateManifest(m);
  return [
    {name:'create_event',payload:{event:{id:m.eventId,name:m.eventName,type:'corporate',start_date:m.date,end_date:m.date}}},
    {name:'configure_event_custody',payload:{event_id:m.eventId,action:'enable',idempotency_key:keyFor(m,'enable')}},
    {name:'configure_event_custody',payload:{event_id:m.eventId,action:'assign',seller_email:m.actors.seller,idempotency_key:keyFor(m,'assign')}},
    {name:'request_event_fulfillment',payload:{event_id:m.eventId,requesting_department:m.department,cost_center:m.costCenter,
      required_date:m.date,purpose:`Synthetic first smoke ${m.runId}`,expense_treatment:'expense',lines:m.lines,idempotency_key:keyFor(m,'demand')}},
  ];
}
