// Reuse the existing Task 10 setup, without registering its unrelated tests.
// Real policy functions execute; this is NOT an all-repository bootstrap.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./verify-mpic-procurement-policy-alignment.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf("test('executes the disposable public Task 10 vendor and payment authority matrix'");
const marker = '    await db.exec(migrationPaymentStalenessTrigger);';
const end = source.indexOf(marker, start) + marker.length;
assert(start > 0 && end > start, 'Existing Task 10 fixture markers changed');
let prefix = source.slice(0, source.indexOf('test("accepts the hardened canonical'));
// The reused fixture rewrites this boundary per actor; retain the production
// argument names after loading the real has_live_cap definition.
prefix = prefix.replaceAll('core.has_live_cap(text, text) returns','core.has_live_cap(p_module text, p_cap text) returns');
prefix = prefix.replace('"@electric-sql/pglite"', JSON.stringify(pathToFileURL(require.resolve('@electric-sql/pglite')).href));
prefix = prefix.replace('"./verify-mpic-procurement-policy-alignment.mjs"', JSON.stringify(new URL('./verify-mpic-procurement-policy-alignment.mjs', import.meta.url).href));
prefix += `\nimport { runIntegrationChecks } from ${JSON.stringify(new URL('./sep05-procurement-integration-checks.mjs', import.meta.url).href)};\n`;
const setup = source.slice(start, end).replace('executes the disposable public Task 10 vendor and payment authority matrix','Sep05 integration: actual policy, decision, storage RLS and lifecycle');
const endTest = '\nawait runIntegrationChecks({db,withRole,maker,legalDecider,procurement,finance,vendorActor,vendorId,reviewId}); } finally { await db.close(); } });';
await import('data:text/javascript;base64,' + Buffer.from(prefix + setup + endTest).toString('base64'));
