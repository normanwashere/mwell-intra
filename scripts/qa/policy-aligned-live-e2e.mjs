#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const required = [
  'AUDIT_BASE_URL',
  'AUDIT_PASSWORD',
  'AUDIT_RUN_ID',
  'POLICY_TEST_PROJECT_REF',
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
if (!process.env.NEXT_PUBLIC_SUPABASE_URL.includes(process.env.POLICY_TEST_PROJECT_REF)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL must match POLICY_TEST_PROJECT_REF.');
}
if (process.env.AUDIT_MUTATIONS === 'true' && process.env.POLICY_ALLOW_TEST_MUTATIONS !== 'true') {
  throw new Error('Mutation runs require POLICY_ALLOW_TEST_MUTATIONS=true.');
}

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
