const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.MWELL_W1_TEST_PASSWORD;
if (!url || !serviceKey || !password) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MWELL_W1_TEST_PASSWORD are required.');
}

const roles = ['logistics_supervisor', 'operations', 'finance', 'bi_analyst', 'business_unit', 'marketing', 'procurement', 'pricing', 'warehouse_admin'];
const emailAliases = { logistics_supervisor: 'logistics', bi_analyst: 'bi', business_unit: 'business.unit', warehouse_admin: 'warehouse.admin' };
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const request = async (endpoint, options = {}) => {
  const response = await fetch(`${url}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${endpoint} failed (${response.status}).`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};

const listed = await request('/auth/v1/admin/users?per_page=1000');
for (const role of roles) {
  const email = `intra.test.wh.${emailAliases[role] ?? role}@mwell.com.ph`;
  let user = listed.users.find((candidate) => candidate.email?.toLowerCase() === email);
  const attributes = { email, password, email_confirm: true, app_metadata: { roles: { core: ['staff'], warehouse: [role] } } };
  user = user
    ? await request(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify(attributes) })
    : await request('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(attributes) });
  const schemaHeaders = { 'Content-Profile': 'core', 'Accept-Profile': 'core', Prefer: 'resolution=merge-duplicates,return=minimal' };
  await request('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: schemaHeaders, body: JSON.stringify({ id: user.id, email, full_name: `Warehouse W1 ${role}`, title: role, kind: 'employee', status: 'active' }) });
  await request(`/rest/v1/user_roles?user_id=eq.${user.id}&module=eq.warehouse`, { method: 'DELETE', headers: schemaHeaders });
  await request('/rest/v1/user_roles?on_conflict=user_id,module,role', { method: 'POST', headers: schemaHeaders, body: JSON.stringify({ user_id: user.id, module: 'warehouse', role }) });
  console.log(`Provisioned ${email} with warehouse role ${role}.`);
}
