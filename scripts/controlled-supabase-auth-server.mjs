import http from 'node:http';

const port = Number(process.env.CONTROLLED_SUPABASE_PORT ?? 54321);

const users = {
  'controlled-procurement': {
    id: 'controlled-procurement',
    email: 'procurement.controlled@mwell.test',
    name: 'Controlled Procurement Officer',
    title: 'Procurement Officer',
    roles: { core: ['staff'], procurement: ['procurement_officer'] },
  },
  'controlled-admin': {
    id: 'controlled-admin',
    email: 'admin.controlled@mwell.test',
    name: 'Controlled Platform Administrator',
    title: 'Platform Administrator',
    roles: { core: ['platform_admin', 'staff'] },
  },
  'controlled-legal': {
    id: 'controlled-legal',
    email: 'legal.controlled@mwell.test',
    name: 'Controlled Legal Administrator',
    title: 'Legal & Compliance Lead',
    roles: { core: ['staff'], legal: ['admin'] },
  },
  'controlled-operations': {
    id: 'controlled-operations',
    email: 'operations.controlled@mwell.test',
    name: 'Controlled Operations Requester',
    title: 'Operations Associate',
    roles: { core: ['staff'], procurement: ['requester'] },
  },
};

function userFor(id) {
  const user = users[id] ?? users['controlled-operations'];
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: '2026-08-22T00:00:00.000Z',
    app_metadata: { roles: user.roles, kind: 'employee' },
    user_metadata: { name: user.name, title: user.title },
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
  };
}

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-profile, accept-profile, content-type',
  });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.url?.startsWith('/auth/v1/user')) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return reply(res, 200, userFor(token));
  }
  return reply(res, 200, {});
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Controlled Supabase auth boundary listening on ${port}\n`);
});
