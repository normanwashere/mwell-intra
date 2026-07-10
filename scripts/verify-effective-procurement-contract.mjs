#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const SIGNATURE = /create\s+or\s+replace\s+function\s+procurement\.submit_request\s*\(\s*payload\s+jsonb\s*\)/gi;

function effectiveDefinition() {
  let effective = null;
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const starts = [...sql.matchAll(SIGNATURE)];
    for (const start of starts) {
      const bodyStart = start.index ?? 0;
      const bodyEnd = sql.indexOf('$$;', bodyStart);
      if (bodyEnd === -1) throw new Error(`${file}: unterminated submit_request definition`);
      effective = { file, sql: sql.slice(bodyStart, bodyEnd + 3) };
    }
  }
  if (!effective) throw new Error('No procurement.submit_request(payload jsonb) migration found.');
  return effective;
}

const definition = effectiveDefinition();
const failures = [];

if (/v_tiers\s*:=\s*v_tiers\s*\|\|\s*'[^']+'/i.test(definition.sql)) {
  failures.push('uses scalar text concatenation for a text[] approval ladder');
}
if (!/procurement\.derive_approval_tiers\s*\(/i.test(definition.sql)) {
  failures.push('does not call procurement.derive_approval_tiers');
}
if (!/for\s+update/i.test(definition.sql)) {
  failures.push('does not lock the draft request before transition');
}
if (!/set\s+search_path\s*=\s*''/i.test(definition.sql)) {
  failures.push('does not use an empty security-definer search_path');
}

if (failures.length > 0) {
  console.error(`FAIL ${definition.file}: effective procurement.submit_request ${failures.join('; ')}.`);
  process.exit(1);
}

console.log(`PASS ${definition.file}: effective procurement.submit_request contract is hardened.`);
