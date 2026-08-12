-- Keep governed orientation content checkpoint-backed in every environment.
-- Existing non-compliant rows make deployment fail closed; published content
-- must be superseded through the governed publisher rather than edited in place.

alter table learning.requirement_versions
  add constraint requirement_versions_orientation_runtime_check
  check (
    requirement_kind <> 'orientation'
    or (
      nullif(pg_catalog.btrim(simulation_id), '') is not null
      and pg_catalog.jsonb_typeof(pass_rules->'required_checkpoints') = 'array'
      and (pass_rules->'required_checkpoints') ? 'complete'
    )
  ) not valid;

alter table learning.requirement_versions
  validate constraint requirement_versions_orientation_runtime_check;
