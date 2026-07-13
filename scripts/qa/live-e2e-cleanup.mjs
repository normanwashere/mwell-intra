import { assertAuditRunId } from "./live-e2e-scenarios.mjs";
import { createAuditDatabaseClient } from "./live-e2e-db-verify.mjs";

function applyFilters(query, filters) {
  const entries = Object.entries(filters ?? {});
  if (!entries.length) throw new Error("Cleanup refuses an unscoped delete.");
  return entries.reduce((current, [column, value]) => current.eq(column, value), query);
}

export async function cleanupRun(
  runId,
  targets,
  client = createAuditDatabaseClient(),
) {
  assertAuditRunId(runId);
  const results = [];

  for (const target of targets) {
    const entity = `${target.schema}.${target.table}`;
    try {
      if (target.runId !== runId)
        throw new Error(`Cleanup target is not bound to ${runId}.`);
      let beforeQuery = client
        .schema(target.schema)
        .from(target.table)
        .select(target.proofColumn);
      beforeQuery = applyFilters(beforeQuery, target.filters);
      const { data: before, error: beforeError } = await beforeQuery;
      if (beforeError) throw new Error(beforeError.message);
      for (const row of before ?? [])
        if (!String(row[target.proofColumn] ?? "").includes(runId))
          throw new Error("Run marker is absent from the cleanup proof.");

      let deleteQuery = client.schema(target.schema).from(target.table).delete();
      deleteQuery = applyFilters(deleteQuery, target.filters);
      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw new Error(deleteError.message);

      let afterQuery = client
        .schema(target.schema)
        .from(target.table)
        .select(target.proofColumn, { count: "exact", head: true });
      afterQuery = applyFilters(afterQuery, target.filters);
      const { count, error: afterError } = await afterQuery;
      if (afterError) throw new Error(afterError.message);
      results.push({
        entity,
        removed: before?.length ?? 0,
        remaining: count ?? 0,
      });
    } catch (error) {
      results.push({
        entity,
        removed: 0,
        remaining: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const complete = results.every(
    (item) => item.remaining === 0 && !item.error,
  );
  return { runId, complete, results };
}
