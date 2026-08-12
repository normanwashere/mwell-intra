import pg from "pg";
import {
  CI_ORIENTATION_OWNER,
  CI_ORIENTATION_REVIEWER,
  CI_ORIENTATION_DEPARTMENT_ID,
  ORIENTATION_CATALOG,
} from "./learning-orientation-catalog.mjs";

const databaseUrl = process.env.MWELL_LOCAL_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
const bootstrapCi = process.argv.includes("--ci-bootstrap");
if (!databaseUrl) throw new Error("MWELL_LOCAL_DATABASE_URL or SUPABASE_DB_URL is required.");

const client = new pg.Client({ connectionString: databaseUrl });

async function bootstrapReviewer(profile) {
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at, raw_app_meta_data,
       raw_user_meta_data, confirmation_token, recovery_token,
       email_change_token_new, email_change, is_sso_user, is_anonymous
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated',
       'authenticated', $2, '', clock_timestamp(), clock_timestamp(),
       clock_timestamp(), '{"provider":"email","providers":["email"],"kind":"employee"}'::jsonb,
       '{}'::jsonb, '', '', '', '', false, false
     ) on conflict (id) do nothing`,
    [profile.id, profile.email],
  );
  await client.query(
    `insert into core.profiles (id, email, full_name, kind, status)
     values ($1, $2, $3, 'employee', 'active')
     on conflict (id) do update set status = 'active'`,
    [profile.id, profile.email, profile.email.split("@")[0]],
  );
}

async function profileId(email, label) {
  const result = await client.query(
    `select id from core.profiles
      where lower(email) = lower($1) and kind = 'employee' and status = 'active'`,
    [email],
  );
  if (result.rowCount !== 1) {
    throw new Error(`${label} must resolve to exactly one active employee profile.`);
  }
  return result.rows[0].id;
}

async function advanceVersion(table, id) {
  const allowed = new Set(["learning.requirement_versions", "learning.curriculum_versions"]);
  if (!allowed.has(table)) throw new Error("Unexpected learning version table.");
  let { rows: [row] } = await client.query(`select status from ${table} where id = $1 for update`, [id]);
  if (row.status === "draft") {
    await client.query(`update ${table} set status = 'in_review' where id = $1`, [id]);
    row = { status: "in_review" };
  }
  if (row.status === "in_review") {
    await client.query(
      `update ${table}
          set status = 'approved', reviewer_id = $2, approved_at = statement_timestamp(),
              effective_at = statement_timestamp()
        where id = $1`,
      [id, reviewerId],
    );
    row = { status: "approved" };
  }
  if (row.status === "approved") {
    await client.query(
      `update ${table}
          set status = 'published', published_at = effective_at
        where id = $1`,
      [id],
    );
    row = { status: "published" };
  }
  if (row.status !== "published") {
    throw new Error(`${table} ${id} is ${row.status}; governed publication cannot continue.`);
  }
}

let ownerId;
let reviewerId;
try {
  await client.connect();
  await client.query("begin isolation level read committed");
  await client.query("select pg_advisory_xact_lock(hashtext('mwell.learning.orientation.publisher'))");
  if (bootstrapCi) {
    const host = new URL(databaseUrl.replace(/^postgresql:/, "http:" )).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) {
      throw new Error("--ci-bootstrap is restricted to a local database.");
    }
    await bootstrapReviewer(CI_ORIENTATION_OWNER);
    await bootstrapReviewer(CI_ORIENTATION_REVIEWER);
    await client.query(
      `insert into core.departments (id, code, name, is_active)
       values ($1, 'learning.orientation.ci', 'Learning Orientation CI', true)
       on conflict (id) do update set is_active = true`,
      [CI_ORIENTATION_DEPARTMENT_ID],
    );
    await client.query(
      `insert into core.profile_department_scopes (
         profile_id, department_id, scope_type, effective_from, created_by
       ) values ($1, $2, 'primary', current_date, $1)
       on conflict (profile_id, department_id, scope_type, effective_from) do nothing`,
      [CI_ORIENTATION_OWNER.id, CI_ORIENTATION_DEPARTMENT_ID],
    );
    await client.query(
      `insert into core.user_roles (user_id, module, role)
       values ($1, 'core', 'platform_admin')
       on conflict (user_id, module, role) do nothing`,
      [CI_ORIENTATION_OWNER.id],
    );
  }
  const ownerEmail = bootstrapCi
    ? CI_ORIENTATION_OWNER.email
    : process.env.MWELL_LEARNING_OWNER_EMAIL;
  const reviewerEmail = bootstrapCi
    ? CI_ORIENTATION_REVIEWER.email
    : process.env.MWELL_LEARNING_REVIEWER_EMAIL;
  if (!ownerEmail || !reviewerEmail || ownerEmail.toLowerCase() === reviewerEmail.toLowerCase()) {
    throw new Error("Distinct MWELL_LEARNING_OWNER_EMAIL and MWELL_LEARNING_REVIEWER_EMAIL values are required.");
  }
  ownerId = await profileId(ownerEmail, "Learning owner");
  reviewerId = await profileId(reviewerEmail, "Learning reviewer");

  for (const item of ORIENTATION_CATALOG) {
    const requirement = await client.query(
      `insert into learning.requirements (
         requirement_key, audience, requirement_kind, governance_owner,
         status, created_by
       ) values ($1, $2, 'orientation', 'platform', 'active', $3)
       on conflict (requirement_key) do update set requirement_key = excluded.requirement_key
       returning id, audience, requirement_kind, governance_owner, status`,
      [item.requirementKey, item.audience, ownerId],
    );
    const requirementRow = requirement.rows[0];
    if (
      requirementRow.audience !== item.audience ||
      requirementRow.requirement_kind !== "orientation" ||
      requirementRow.governance_owner !== "platform" ||
      requirementRow.status !== "active"
    ) throw new Error(`Requirement ${item.requirementKey} conflicts with the governed catalog.`);

    const requirementVersion = await client.query(
      `insert into learning.requirement_versions (
         requirement_id, audience, requirement_kind, governance_owner, version,
         status, title, simulation_id, pass_rules, estimated_minutes, waivable,
         change_reason, materiality, source_references, owner_id
       ) values (
         $1, $2, 'orientation', 'platform', $3, 'draft', $4, $5,
         '{"required_checkpoints":["complete"]}'::jsonb, 5, false,
         'Initial governed role orientation', 'material',
         '[{"type":"application_catalog","version":1}]'::jsonb, $6
       ) on conflict (requirement_id, version) do nothing
       returning id`,
      [requirementRow.id, item.audience, item.version, item.title, item.simulationId, ownerId],
    );
    const requirementVersionId = requirementVersion.rows[0]?.id ?? (
      await client.query(
        `select id from learning.requirement_versions where requirement_id = $1 and version = $2`,
        [requirementRow.id, item.version],
      )
    ).rows[0]?.id;
    if (!requirementVersionId) throw new Error(`Missing version for ${item.requirementKey}.`);
    await advanceVersion("learning.requirement_versions", requirementVersionId);

    const curriculum = await client.query(
      `insert into learning.curricula (
         catalog_key, audience, governance_owner, status, created_by
       ) values ($1, $2, 'platform', 'active', $3)
       on conflict (catalog_key) do update set catalog_key = excluded.catalog_key
       returning id, audience, governance_owner, status`,
      [item.curriculumKey, item.audience, ownerId],
    );
    const curriculumRow = curriculum.rows[0];
    if (
      curriculumRow.audience !== item.audience ||
      curriculumRow.governance_owner !== "platform" ||
      curriculumRow.status !== "active"
    ) throw new Error(`Curriculum ${item.curriculumKey} conflicts with the governed catalog.`);

    const curriculumVersion = await client.query(
      `insert into learning.curriculum_versions (
         curriculum_id, audience, version, status, change_reason, materiality,
         source_references, owner_id
       ) values ($1, $2, $3, 'draft', 'Initial governed role orientation',
         'material', '[{"type":"application_catalog","version":1}]'::jsonb, $4)
       on conflict (curriculum_id, version) do nothing returning id`,
      [curriculumRow.id, item.audience, item.version, ownerId],
    );
    const curriculumVersionId = curriculumVersion.rows[0]?.id ?? (
      await client.query(
        `select id from learning.curriculum_versions where curriculum_id = $1 and version = $2`,
        [curriculumRow.id, item.version],
      )
    ).rows[0]?.id;
    if (!curriculumVersionId) throw new Error(`Missing version for ${item.curriculumKey}.`);
    const status = await client.query(
      `select status from learning.curriculum_versions where id = $1`,
      [curriculumVersionId],
    );
    if (["draft", "in_review"].includes(status.rows[0].status)) {
      await client.query(
        `insert into learning.curriculum_requirements (
           curriculum_version_id, requirement_version_id, audience, sort_order,
           mandatory, created_by
         ) values ($1, $2, $3, 0, true, $4)
         on conflict (curriculum_version_id, requirement_version_id) do nothing`,
        [curriculumVersionId, requirementVersionId, item.audience, ownerId],
      );
    }
    await advanceVersion("learning.curriculum_versions", curriculumVersionId);
    const effective = await client.query(
      `select effective_at from learning.curriculum_versions where id = $1`,
      [curriculumVersionId],
    );
    for (const role of item.roles) {
      await client.query(
        `insert into learning.role_curricula (
           module, role, curriculum_version_id, audience, department_id,
           effective_at, created_by
         ) select $1, $2, $3, $4, null, $5, $6
         where not exists (
           select 1 from learning.role_curricula
            where module = $1 and role = $2
              and curriculum_version_id = $3 and department_id is null
         )`,
        [
          role.module,
          role.role,
          curriculumVersionId,
          item.audience,
          effective.rows[0].effective_at,
          ownerId,
        ],
      );
    }
  }
  await client.query("commit");
  console.log(`Published ${ORIENTATION_CATALOG.length} governed orientation curricula.`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
