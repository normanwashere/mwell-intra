import assert from 'node:assert/strict';
import test from 'node:test';
import { permittedRequest } from './scoped-live-learning-flow.mjs';
import { VENDOR_CASES } from './vendor-live-learning-cases.mjs';

test('attestation permits only current assigned attempt and expected reviewed checkpoint', () => {
  const input = {url:'https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/record_simulation_checkpoint',method:'POST',mobile:false,
    target:VENDOR_CASES[0],assignmentId:'assignment',attemptId:'attempt',attestationCheckpoint:'review-evidence',
    body:{payload:{assignment_requirement_id:'assignment',attempt_id:'attempt',checkpoint_id:'review-evidence',outcome_id:'reviewed',idempotency_key:'unique'}}};
  assert.equal(permittedRequest(input),true);
  for (const patch of [{assignment_requirement_id:'foreign'},{attempt_id:'foreign'},{checkpoint_id:'complete'},{outcome_id:'approved'},{actor_id:'fake'}]) {
    assert.equal(permittedRequest({...input,body:{payload:{...input.body.payload,...patch}}}),false);
  }
  assert.equal(permittedRequest({...input,mobile:true}),false);
  assert.equal(permittedRequest({...input,attemptId:undefined}),false);
});

test('existing practice readback cannot start or submit choices', () => {
  const input = {method:'POST',mobile:false,target:{...VENDOR_CASES[1],readOnly:true},assignmentId:'assignment'};
  assert.equal(permittedRequest({...input,url:'https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/start_requirement',body:{payload:{assignment_requirement_id:'assignment'}}}),false);
  assert.equal(permittedRequest({...input,url:'https://mwell-intra-uat.vercel.app/api/learning/simulation-choice',body:{simulationId:VENDOR_CASES[1].simulationId,assignmentRequirementId:'assignment'}}),false);
});
