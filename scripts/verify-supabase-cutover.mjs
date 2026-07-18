#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectRefFromSupabaseUrl } from './lib/target-environment.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENV_FILES = [
  resolve(ROOT, '.env'),
  resolve(ROOT, '.env.local'),
  resolve(ROOT, 'apps/shell/.env.local'),
  resolve(ROOT, 'apps/shell/.env'),
];

const REQUIRED = {
  core: [
    "activity_log",
    "approval_groups",
    "approvals",
    "capabilities",
    "departments",
    "documents",
    "notifications",
    "policy_remediation_queue",
    "profile_department_scopes",
    "profiles",
    "role_capabilities",
    "roles",
    "user_roles",
    "vendors",
  ],
  legal: [
    "accreditation_cases",
    "accreditation_dispositions",
    "accreditation_docs",
    "case_timeline",
    "instrument_documents",
    "instrument_lifecycle_events",
    "instrument_signatures",
    "policy_definitions",
    "requirement_checklist_items",
    "signed_instruments",
    "vendor_application_snapshots",
    "vendor_invites",
    "vendor_technology_qualifications",
  ],
  procurement: [
    "acceptance_packs",
    "acceptance_reviewer_assignments",
    "approval_steps",
    "doa_assignments",
    "doa_matrices",
    "exception_packs",
    "financial_protection_requirements",
    "payment_readiness_packs",
    "payment_readiness_staleness_events",
    "policy_evidence",
    "purchase_order_amendment_steps",
    "purchase_order_amendments",
    "purchase_order_lines",
    "purchase_orders",
    "receipt_reconciliations",
    "receipts",
    "request_attachments",
    "requests",
    "route_decisions",
    "sourcing_events",
    "sourcing_responses",
  ],
  warehouse: [
    "allocations",
    "command_log",
    "cycle_counts",
    "events",
    "exceptions",
    "export_jobs",
    "import_errors",
    "import_jobs",
    "inventory_holds",
    "inventory_units",
    "locations",
    "lots",
    "movements",
    "operation_routes",
    "operation_types",
    "procurement_receipt_exception_decisions",
    "procurement_receipt_exception_lines",
    "procurement_receipt_excess_custody",
    "products",
    "profiles",
    "purchase_orders",
    "quality_inspections",
    "receipts",
    "returns",
    "role_capabilities",
    "stock_change_requests",
    "stock_levels",
    "storage_areas",
    "suppliers",
    "unidentified_receipt_custody",
    "vendor_returns",
  ],
};

// These internal ledgers deliberately have no direct authenticated SELECT grant.
// Governed RPCs expose only the role-scoped work items needed by the app.
const SERVICE_ONLY_TABLES = new Set([
  "core.approval_groups",
  "procurement.acceptance_reviewer_assignments",
  "procurement.payment_readiness_staleness_events",
  "procurement.purchase_order_amendment_steps",
  "procurement.receipt_reconciliations",
  "warehouse.command_log",
  "warehouse.procurement_receipt_exception_decisions",
  "warehouse.procurement_receipt_exception_lines",
  "warehouse.procurement_receipt_excess_custody",
  "warehouse.role_capabilities",
  "warehouse.unidentified_receipt_custody",
]);

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

export function validateCutoverTarget({ appEnv, url, expectedProjectRef }) {
  if (!['local', 'uat', 'production'].includes(appEnv)) {
    throw new Error(
      'APP_ENV must be explicitly set to local, uat, or production for a cutover check.',
    );
  }
  if (!/^[a-z0-9]+$/.test(expectedProjectRef ?? '')) {
    throw new Error(
      'SUPABASE_PROJECT_REF must be explicitly set to a canonical project ref.',
    );
  }
  const actualProjectRef = projectRefFromSupabaseUrl(url);
  if (!actualProjectRef) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a canonical Supabase project URL.');
  }
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL project ref does not match SUPABASE_PROJECT_REF.',
    );
  }
  return actualProjectRef;
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

async function callRpc({ url, anonKey, accessToken, schema, fn, body }) {
  const response = await fetch(new URL(`/rest/v1/rpc/${fn}`, url), {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Accept-Profile': schema,
      'Content-Profile': schema,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (response.ok) return response.json();

  let detail = `${response.status} ${response.statusText}`;
  try {
    const payload = await response.json();
    detail = [payload.code, payload.message].filter(Boolean).join(' - ') || detail;
  } catch {
    // Keep the HTTP status detail.
  }
  throw new Error(`${schema}.${fn}: ${detail}`);
}

async function main() {
  const appEnv = readEnv('APP_ENV');
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const expectedProjectRef = readEnv('SUPABASE_PROJECT_REF');
  const verifierEmail = readEnv('SUPABASE_VERIFY_EMAIL') ?? readEnv('AUDIT_EMAIL');
  const verifierPassword =
    readEnv('SUPABASE_VERIFY_PASSWORD') ?? readEnv('AUDIT_PASSWORD');

  if (!url || !anonKey) {
    console.error(
      'FAIL Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
    process.exit(1);
  }
  try {
    validateCutoverTarget({ appEnv, url, expectedProjectRef });
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
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
      if (SERVICE_ONLY_TABLES.has(label)) {
        if (!result.ok && [401, 403].includes(result.status)) {
          console.log(`PASS ${label} (service-only; authenticated read denied)`);
        } else {
          failures.push({
            label,
            ...result,
            detail: result.ok
              ? 'authenticated read unexpectedly succeeded'
              : `expected 401/403 denial, received ${result.detail}`,
          });
          console.error(`FAIL ${label}: service-only boundary is not enforced`);
        }
        continue;
      }
      if (result.ok) {
        console.log(`PASS ${label}`);
      } else {
        failures.push({ label, ...result });
        console.error(`FAIL ${label}: ${result.detail}`);
      }
    }
  }

  const ladderScenarios = [
    {
      label: 'low-value goods',
      input: { p_category: 'goods', p_amount: 10_000, p_sourcing: 'small_purchase' },
      expected: ['dept_head', 'procurement_head', 'final_approver'],
    },
    {
      label: 'services at finance threshold',
      input: { p_category: 'services', p_amount: 200_000, p_sourcing: 'rfq' },
      expected: ['dept_head', 'procurement_head', 'legal', 'finance', 'final_approver'],
    },
    {
      label: 'high-value RFP',
      input: { p_category: 'goods', p_amount: 1_000_000, p_sourcing: 'rfp' },
      expected: ['dept_head', 'procurement_head', 'legal', 'finance', 'final_approver'],
    },
  ];
  for (const scenario of ladderScenarios) {
    try {
      const actual = await callRpc({
        url,
        anonKey,
        accessToken,
        schema: 'procurement',
        fn: 'derive_approval_tiers',
        body: scenario.input,
      });
      if (JSON.stringify(actual) !== JSON.stringify(scenario.expected)) {
        throw new Error(`expected ${JSON.stringify(scenario.expected)}, received ${JSON.stringify(actual)}`);
      }
      console.log(`PASS procurement approval ladder: ${scenario.label}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push({ label: `procurement ladder: ${scenario.label}`, detail });
      console.error(`FAIL procurement approval ladder: ${scenario.label}: ${detail}`);
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

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
