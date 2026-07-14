#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationDirectory = resolve(root, 'supabase/migrations');
const migrationNames = readdirSync(migrationDirectory).filter((name) =>
  name.endsWith('_core_organization_extensibility.sql'),
);

assert.equal(
  migrationNames.length,
  1,
  `Expected exactly one core organization extensibility migration, found ${migrationNames.length}.`,
);

const migrationName = migrationNames[0];
assert.equal(
  migrationName,
  '20260714175057_core_organization_extensibility.sql',
  'Use the CLI-generated Task 2 migration without creating another.',
);

const sql = readFileSync(resolve(migrationDirectory, migrationName), 'utf8');
const requirements = [
  ['hierarchical departments table', /create table if not exists core\.departments/i],
  ['stable department code', /code text not null unique/i],
  ['optional parent with restricted deletion', /parent_id uuid references core\.departments\s*\(id\) on delete restrict/i],
  ['soft-active department status', /is_active boolean not null default true/i],
  ['stable department ordering', /sort_order integer not null/i],
  ['cycle prevention', /with recursive descendants[\s\S]*department hierarchy cycle/i],
  ['scoped profile assignments', /create table if not exists core\.profile_department_scopes/i],
  ['historical assignment integrity', /department_id uuid not null references core\.departments\s*\(id\) on delete restrict/i],
  ['effective scope dates', /effective_from date not null[\s\S]*effective_to date/i],
  ['department read RPC', /create or replace function core\.list_departments\s*\(\s*\)/i],
  ['department write RPC', /create or replace function core\.upsert_department\s*\(payload jsonb\)/i],
  ['department assignment RPC', /create or replace function core\.assign_profile_department\s*\(payload jsonb\)/i],
  ['live RBAC catalogue RPC', /create or replace function core\.list_rbac_catalog\s*\(\s*\)/i],
  ['role bundle write RPC', /create or replace function core\.upsert_role_bundle\s*\(payload jsonb\)/i],
  ['effective capability RPC', /create or replace function core\.my_capabilities\s*\(\s*\)/i],
  ['authoritative administration gate', /core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i],
  ['capability catalogue validation', /join core\.capabilities|from core\.capabilities/i],
  ['protected bootstrap roles', /protected bootstrap role/i],
  ['self escalation prevention', /cannot grant core:manage_rbac|self-escalation/i],
  ['self assignment prevention', /cannot modify your own role assignment|self-assignment/i],
  ['unresolved-work deactivation guard', /unresolved work/i],
  ['before and after audit snapshots', /jsonb_build_object\s*\(\s*'before'[\s\S]*'after'/i],
  ['Warehouse Operator seed', /'warehouse'\s*,\s*'warehouse_operator'\s*,\s*'Warehouse Operator'/i],
  ['Warehouse Supervisor seed', /'warehouse'\s*,\s*'warehouse_supervisor'\s*,\s*'Warehouse Supervisor'/i],
  ['legacy Operations alias preserved', /'warehouse'\s*,\s*'operations'/i],
  ['legacy Logistics Supervisor alias preserved', /'warehouse'\s*,\s*'logistics_supervisor'/i],
  ['Product go-live authority', /product[\s\S]*go-live authority/i],
];

for (const [label, pattern] of requirements) {
  assert.match(sql, pattern, `Missing organization contract: ${label}`);
}

for (const code of [
  'marketing',
  'sales',
  'product',
  'technology',
  'pmo',
  'operations',
  'operations.warehouse_logistics',
  'operations.customer_service',
  'operations.client_product_implementation',
  'finance',
  'procurement',
  'legal_compliance',
  'people_culture',
  'administration',
]) {
  assert.match(sql, new RegExp(`'${code.replace('.', '\\\.')}'`, 'i'), `Missing department seed: ${code}`);
}

console.log(`Organization contract passed: ${migrationName}`);
