import assert from 'node:assert/strict';
import test from 'node:test';
import { CASES, permittedRequest, validateEnvironment } from './scoped-live-learning-flow.mjs';
test('no live start without explicit main GO and learning-only UAT environment', () => {
  assert.throws(() => validateEnvironment({}));
  const env = { AUDIT_LEARNING_GO:'MAIN_GO_AFTER_READONLY_SWEEP', AUDIT_MUTATIONS:'learning-only', APP_ENV:'uat',
    AUDIT_BASE_URL:'https://mwell-intra-uat.vercel.app', SUPABASE_PROJECT_REF:'kkoitlvydytdhlpxhuah',
    NEXT_PUBLIC_SUPABASE_URL:'https://kkoitlvydytdhlpxhuah.supabase.co',AUDIT_EXPECTED_SHA:'a'.repeat(40),AUDIT_PASSWORD:'local-unused-fixture' };
  validateEnvironment(env);
  for (const patch of [{AUDIT_LEARNING_GO:''},{APP_ENV:'production'},{AUDIT_MUTATIONS:'true'},{AUDIT_EXPECTED_SHA:'short'}]) {
    assert.throws(() => validateEnvironment({...env,...patch}));
  }
});
test('exact four synthetic learner targets; no admin, role writes, business RPCs or direct checkpoints', () => {
  assert.equal(CASES.length,4);
  assert.equal(CASES.filter((c)=>c.role==='operations_associate').length,3);
  assert.equal(CASES.filter((c)=>c.role==='finance_controller').length,1);
  const base={method:'POST',mobile:false,target:CASES[0],assignmentId:'scoped-id'};
  for (const rpc of ['inspect_quality','transfer','issue','release_payment','record_simulation_checkpoint','complete_requirement','manage_user_roles']) {
    assert.equal(permittedRequest({...base,url:`https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/${rpc}`}),false);
    assert.equal(permittedRequest({...base,method:'GET',url:`https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/${rpc}`}),false);
  }
  const url='https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/start_requirement';
  assert.equal(permittedRequest({...base,url,body:{payload:{assignment_requirement_id:'other'}}}),false);
  assert.equal(permittedRequest({...base,url,body:{payload:{assignment_requirement_id:'scoped-id'}}}),true);
  assert.equal(permittedRequest({...base,url,mobile:true,body:{payload:{assignment_requirement_id:'scoped-id'}}}),false);
  for (const mobile of [false,true]) {
    assert.equal(permittedRequest({...base,mobile,url:'https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/my_capability_snapshot'}),true);
  }
});
test('choice calls restricted to exact active requirement/scenario; mobile never posts a choice', () => {
  const input={url:'https://mwell-intra-uat.vercel.app/api/learning/simulation-choice',method:'POST',mobile:false,
    target:CASES[0],assignmentId:'one',body:{simulationId:CASES[0].simulationId,assignmentRequirementId:'one'}};
  assert.equal(permittedRequest(input),true);
  assert.equal(permittedRequest({...input,mobile:true}),false);
  assert.equal(permittedRequest({...input,body:{...input.body,simulationId:CASES[3].simulationId}}),false);
});
