#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  assertApprovedMutationTarget,
  projectRefFromSupabaseUrl,
} from '../lib/target-environment.mjs';

const required = [
  'AUDIT_BASE_URL',
  'AUDIT_PASSWORD',
  'AUDIT_RUN_ID',
  'APP_ENV',
  'SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required live policy gate values: ${missing.join(', ')}`);
}
if (!process.env.AUDIT_BASE_URL.startsWith('https://')) {
  throw new Error('AUDIT_BASE_URL must use HTTPS.');
}
assertApprovedMutationTarget({
  appEnv: process.env.APP_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
  productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  mutationsRequested: process.env.AUDIT_MUTATIONS === 'true',
  mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === 'true',
});
const projectRef = projectRefFromSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
console.log(
  `Live policy target: environment=${process.env.APP_ENV} project=${projectRef}`,
);

const child = spawn(process.execPath, ['scripts/qa/full-intra-live-e2e.mjs'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Live policy gate terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
