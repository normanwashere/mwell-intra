import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("checkpoint projection uses each assigned version without changing snapshot guards", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema learning;
      create table learning.requirement_versions (version int, simulation_id text, pass_rules jsonb);
      insert into learning.requirement_versions values
        (1,'operations-exception-review-v1','{"required_checkpoints":["review-custody-evidence","record-independent-disposition"]}'),
        (2,'operations-exception-review-v1','{"required_checkpoints":["review-custody-evidence","record-independent-disposition","review-procurement-handoff","acknowledge-product-handoff"]}');
      create function learning.my_learning_snapshot_base() returns jsonb
      language plpgsql stable security definer set search_path='' as $$
      begin
        if current_setting('app.test.authorized',true) is distinct from 'yes' then raise exception 'Authentication required'; end if;
        return (select jsonb_agg(jsonb_build_object(
          'simulationId', requirement_version.simulation_id,
          'version', requirement_version.version
        ) order by requirement_version.version) from learning.requirement_versions requirement_version);
      end $$;
    `);
    const migration = await readFile(new URL("../supabase/migrations/20260912045335_align_assigned_training_checkpoints.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await assert.rejects(db.query("select learning.my_learning_snapshot_base()"), /Authentication required/);
    await db.exec("set app.test.authorized='yes'");
    const result = (await db.query("select learning.my_learning_snapshot_base() data")).rows[0].data;
    assert.deepEqual(result.map((item) => item.requiredCheckpointIds.length), [2,4]);
    assert.deepEqual(result.map((item) => item.version), [1,2]);
    await assert.rejects(db.exec(migration), /already projected/);
  } finally { await db.close(); }
});
