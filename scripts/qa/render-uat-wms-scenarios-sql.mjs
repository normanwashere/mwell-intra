#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  UAT_WMS_ACTOR_EMAILS,
  buildUatWmsScenarioFixtures,
} from "./uat-wms-scenario-fixtures.mjs";

const ACTOR_TOKENS = Object.fromEntries(
  Object.keys(UAT_WMS_ACTOR_EMAILS).map((key, index) => [
    key,
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonExpression(rows) {
  const json = JSON.stringify(rows);
  let expression = `$fixtures$${json}$fixtures$`;
  for (const [key, email] of Object.entries(UAT_WMS_ACTOR_EMAILS)) {
    if (!json.includes(ACTOR_TOKENS[key])) continue;
    expression = `replace(${expression}, ${quoteLiteral(ACTOR_TOKENS[key])}, (select id::text from core.profiles where lower(email) = ${quoteLiteral(email.toLowerCase())}))`;
  }
  return `(${expression})::jsonb`;
}

function actorGuard() {
  const emails = Object.values(UAT_WMS_ACTOR_EMAILS)
    .map(quoteLiteral)
    .join(", ");
  return `do $guard$
begin
  if exists (
    select 1
    from unnest(array[${emails}]::text[]) required(email)
    where not exists (
      select 1 from core.profiles profile where lower(profile.email) = lower(required.email)
    )
  ) then
    raise exception 'Required UAT actor profile is missing';
  end if;
end
$guard$;`;
}

export function renderUatWmsScenarioSql() {
  const fixtures = buildUatWmsScenarioFixtures(ACTOR_TOKENS);
  const statements = fixtures.map(({ schema, table, conflict, rows }) => {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const identifiers = columns.map(quoteIdentifier).join(", ");
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const conflictColumns = conflict
      .split(",")
      .map((column) => quoteIdentifier(column.trim()))
      .join(", ");
    return `insert into ${qualifiedTable} (${identifiers})
select ${identifiers}
from jsonb_populate_recordset(null::${qualifiedTable}, ${jsonExpression(rows)})
on conflict (${conflictColumns}) do nothing;`;
  });
  const purchaseOrders = fixtures.find(
    (fixture) =>
      fixture.schema === "procurement" && fixture.table === "purchase_orders",
  )?.rows;
  const requestLinkRepairs = (purchaseOrders ?? []).map(
    (purchaseOrder) =>
      `update procurement.purchase_orders set request_id = ${quoteLiteral(purchaseOrder.request_id)} where id = ${quoteLiteral(purchaseOrder.id)} and request_id is null;`,
  );

  return [
    "begin;",
    actorGuard(),
    ...statements,
    ...requestLinkRepairs,
    "commit;",
    "select 'UAT WMS scenarios seeded' as result;",
  ].join("\n\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(renderUatWmsScenarioSql());
}
