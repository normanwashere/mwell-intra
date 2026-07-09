#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENV_FILES = [
  resolve(ROOT, '.env'),
  resolve(ROOT, '.env.local'),
  resolve(ROOT, 'apps/shell/.env.local'),
  resolve(ROOT, 'apps/shell/.env'),
];

const REQUIRED = {
  core: [
    'profiles',
    'user_roles',
    'vendors',
    'documents',
    'approvals',
    'activity_log',
    'notifications',
    'role_capabilities',
  ],
  legal: ['accreditation_cases', 'requirement_checklist_items'],
  procurement: [
    'requests',
    'approval_steps',
    'purchase_orders',
    'purchase_order_lines',
    'receipts',
  ],
  warehouse: [
    'products',
    'locations',
    'suppliers',
    'purchase_orders',
    'receipts',
    'stock_levels',
    'inventory_units',
    'movements',
  ],
};

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
        return [key, value];
      }),
  );
}

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  for (const file of ENV_FILES) {
    const value = readEnvFile(file)[key];
    if (value) return value;
  }
  return undefined;
}

async function signInVerifier({ url, anonKey, email, password }) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = [body.error, body.error_description, body.msg, body.message]
        .filter(Boolean)
        .join(' - ') || detail;
    } catch {
      // Keep the status detail.
    }
    throw new Error(`Verifier sign-in failed: ${detail}`);
  }

  const body = await response.json();
  if (!body.access_token) throw new Error('Verifier sign-in returned no access token.');
  return body.access_token;
}

async function probeTable({ url, anonKey, accessToken, schema, table }) {
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set('select', '*');
  endpoint.searchParams.set('limit', '1');

  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Accept-Profile': schema,
    },
  });

  if (response.ok) {
    return { ok: true, status: response.status, detail: 'reachable' };
  }

  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    detail = [body.code, body.message].filter(Boolean).join(' - ') || detail;
  } catch {
    const text = await response.text().catch(() => '');
    if (text) detail = text.slice(0, 180);
  }
  return { ok: false, status: response.status, detail };
}

async function main() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const verifierEmail = readEnv('SUPABASE_VERIFY_EMAIL') ?? readEnv('AUDIT_EMAIL');
  const verifierPassword =
    readEnv('SUPABASE_VERIFY_PASSWORD') ?? readEnv('AUDIT_PASSWORD');

  if (!url || !anonKey) {
    console.error(
      'FAIL Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
    process.exit(1);
  }
  if (!verifierEmail || !verifierPassword) {
    console.error(
      'FAIL Supabase verifier credentials missing. Set SUPABASE_VERIFY_EMAIL and SUPABASE_VERIFY_PASSWORD for an authenticated cutover check.',
    );
    process.exit(1);
  }

  const accessToken = await signInVerifier({
    url,
    anonKey,
    email: verifierEmail,
    password: verifierPassword,
  });

  const failures = [];
  const warnings = [];

  for (const [schema, tables] of Object.entries(REQUIRED)) {
    for (const table of tables) {
      const result = await probeTable({ url, anonKey, accessToken, schema, table });
      const label = `${schema}.${table}`;
      if (result.ok) {
        console.log(`PASS ${label}`);
      } else {
        failures.push({ label, ...result });
        console.error(`FAIL ${label}: ${result.detail}`);
      }
    }
  }

  const legacy = await probeTable({
    url,
    anonKey,
    accessToken: anonKey,
    schema: 'public',
    table: 'procurement_requests',
  });
  if (legacy.ok) {
    warnings.push(
      'WARN public.procurement_requests is still exposed. Keep legacy public tables locked down during cutover.',
    );
  }

  for (const warning of warnings) console.warn(warning);

  if (failures.length > 0) {
    console.error(
      `\nSupabase cutover check failed: ${failures.length} required table(s) are not reachable through the app API contract.`,
    );
    process.exit(1);
  }

  console.log('\nSupabase cutover check passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
