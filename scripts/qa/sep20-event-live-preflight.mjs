import assert from 'node:assert/strict';

const checked = result => {
  assert(!result.error, `Request denied (${result.error?.code ?? 'transport'}); inspect authorized server logs`);
  return result.data;
};

function dateOnly(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a date`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert(Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, `${label} is invalid`);
  return value;
}

export async function assertSellerPreflight(client, manifest, actorId, today) {
  assert.equal(typeof actorId, 'string');
  assert.match(actorId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 'Authenticated seller ID required');
  dateOnly(today, 'Current Manila date');
  assert.equal(today, manifest.date, 'Strict Manila event date: do not silently extend the run');

  const profile = checked(await client.schema('core').from('profiles')
    .select('id,status').eq('id', actorId).single());
  assert(profile, 'Seller profile required');
  assert.equal(profile.id, actorId, 'Seller profile identity mismatch');
  assert.equal(profile.status, 'active', 'Seller profile must be active');

  const scopes = checked(await client.schema('core').from('profile_department_scopes')
    .select('profile_id,department_id,scope_type,effective_from,effective_to').eq('profile_id', actorId));
  assert(Array.isArray(scopes) && scopes.length === 1, 'Exactly one seller department scope required');
  const scope = scopes[0];
  assert.equal(scope.profile_id, actorId, 'Seller scope identity mismatch');
  assert.equal(scope.department_id, manifest.departmentId, 'Seller must belong to the pinned Marketing department');
  assert.equal(scope.scope_type, 'member', 'Seller department scope must be member');
  assert(dateOnly(scope.effective_from, 'Membership start') <= today, 'Seller membership is not yet effective');
  if (scope.effective_to !== null) {
    assert(dateOnly(scope.effective_to, 'Membership end') >= today, 'Seller membership has expired');
  }

  const roles = checked(await client.schema('core').from('user_roles')
    .select('module,role').eq('user_id', actorId));
  assert.deepEqual(roles, manifest.sellerRoles, 'Seller roles must exactly match the approved manifest');
}
