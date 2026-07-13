import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { createClient } = require("@supabase/supabase-js");

export function createAuditDatabaseClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live persistence verification.",
    );
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function applyFilters(query, filters) {
  const entries = Object.entries(filters ?? {});
  if (!entries.length) throw new Error("A database checkpoint requires filters.");
  return entries.reduce((current, [column, value]) => current.eq(column, value), query);
}

export async function verifyCheckpoint(
  { schema, table, filters, expected = {}, select = "*" },
  client = createAuditDatabaseClient(),
) {
  let query = client.schema(schema).from(table).select(select);
  query = applyFilters(query, filters);
  const { data, error } = await query;
  if (error) throw new Error(`${schema}.${table} checkpoint failed: ${error.message}`);
  if (!data?.length)
    throw new Error(`${schema}.${table} checkpoint returned no rows.`);
  const row = data[0];
  for (const [column, value] of Object.entries(expected))
    if (row[column] !== value)
      throw new Error(
        `${schema}.${table}.${column} expected ${String(value)}, received ${String(row[column])}.`,
      );
  return {
    entity: `${schema}.${table}`,
    matched: data.length,
    expectedColumns: Object.keys(expected),
  };
}
