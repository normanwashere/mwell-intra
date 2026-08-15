-- Preserve authoritative certification evidence when equivalent role
-- curricula use separate requirement versions for the same simulation.
-- Shared evidence remains limited to published, effective scenario versions
-- and excludes remedial assignments.
create or replace function private.validate_certification_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement_version_id uuid;
  v_target learning.assignment_requirements%rowtype;
  v_source learning.assignment_requirements%rowtype;
  v_kind text;
  v_shared_completion_kind text;
  v_shared_identity text;
  v_attempt_ids jsonb;
  v_acknowledgment_ids jsonb;
  v_evidence jsonb := '[]'::jsonb;
begin
  perform private.assert_learning_read_committed();

  for v_requirement_version_id in
    select evidence_id
    from pg_catalog.unnest(new.requirement_version_ids) evidence_id
    order by evidence_id
  loop
    select requirement.*
    into v_target
    from learning.assignment_requirements requirement
    where requirement.assignment_id = new.assignment_id
      and requirement.user_id = new.user_id
      and requirement.department_id = new.department_id
      and requirement.audience = new.audience
      and requirement.requirement_version_id = v_requirement_version_id;
    if not found or v_target.status not in ('passed', 'waived') then
      raise exception 'Certification requirement completion is missing';
    end if;

    if v_target.status = 'waived' then
      if v_target.waiver_evidence is null
         or v_target.waiver_evidence = '{}'::jsonb then
        raise exception 'Certification waiver evidence is missing';
      end if;
      v_evidence := v_evidence || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'assignment_requirement_id', v_target.id,
          'requirement_version_id', v_requirement_version_id,
          'status', 'waived',
          'waiver_evidence', v_target.waiver_evidence
        )
      );
      continue;
    end if;

    select source_requirement.*
    into v_source
    from learning.assignment_requirements source_requirement
    where source_requirement.id = coalesce(
        nullif(
          v_target.progress->>'shared_completion_source_id',
          ''
        )::uuid,
        v_target.id
      )
      and source_requirement.user_id = new.user_id
      and source_requirement.audience = new.audience
      and source_requirement.status = 'passed';
    if not found then
      raise exception 'Shared certification completion lineage is invalid';
    end if;

    v_shared_completion_kind := null;
    v_shared_identity := null;
    if v_source.requirement_version_id <> v_requirement_version_id then
      v_shared_completion_kind :=
        v_target.progress->>'shared_completion_kind';
      if v_shared_completion_kind = 'equivalent_role_practice' then
        select source_version.simulation_id
        into v_shared_identity
        from learning.requirement_versions source_version
        join learning.requirement_versions target_version
          on target_version.id = v_requirement_version_id
         and target_version.audience = new.audience
        join learning.assignments source_assignment
          on source_assignment.id = v_source.assignment_id
         and source_assignment.user_id = new.user_id
         and source_assignment.audience = new.audience
        join learning.assignments target_assignment
          on target_assignment.id = v_target.assignment_id
         and target_assignment.user_id = new.user_id
         and target_assignment.audience = new.audience
        where source_version.id = v_source.requirement_version_id
          and source_version.audience = new.audience
          and source_version.requirement_kind = 'scenario'
          and target_version.requirement_kind = 'scenario'
          and source_version.status = 'published'
          and target_version.status = 'published'
          and source_version.effective_at <=
            pg_catalog.statement_timestamp()
          and target_version.effective_at <=
            pg_catalog.statement_timestamp()
          and (
            source_version.expires_at is null
            or source_version.expires_at >
              pg_catalog.statement_timestamp()
          )
          and (
            target_version.expires_at is null
            or target_version.expires_at >
              pg_catalog.statement_timestamp()
          )
          and nullif(
            pg_catalog.btrim(source_version.simulation_id),
            ''
          ) is not null
          and target_version.simulation_id = source_version.simulation_id
          and source_assignment.source_type not in (
            'retraining', 'corrective'
          )
          and target_assignment.source_type not in (
            'retraining', 'corrective'
          )
          and source_assignment.status not in ('cancelled', 'superseded')
          and target_assignment.status not in ('cancelled', 'superseded');
      elsif v_shared_completion_kind = 'role_orientation' then
        select pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(source_version.title),
            '\s+',
            ' ',
            'g'
          )
        )
        into v_shared_identity
        from learning.requirement_versions source_version
        join learning.requirement_versions target_version
          on target_version.id = v_requirement_version_id
         and target_version.audience = new.audience
        join learning.assignments source_assignment
          on source_assignment.id = v_source.assignment_id
         and source_assignment.user_id = new.user_id
         and source_assignment.audience = new.audience
        join learning.assignments target_assignment
          on target_assignment.id = v_target.assignment_id
         and target_assignment.user_id = new.user_id
         and target_assignment.audience = new.audience
        where source_version.id = v_source.requirement_version_id
          and source_version.audience = new.audience
          and source_version.requirement_kind = 'orientation'
          and target_version.requirement_kind = 'orientation'
          and source_version.status = 'published'
          and target_version.status = 'published'
          and source_version.effective_at <=
            pg_catalog.statement_timestamp()
          and target_version.effective_at <=
            pg_catalog.statement_timestamp()
          and (
            source_version.expires_at is null
            or source_version.expires_at >
              pg_catalog.statement_timestamp()
          )
          and (
            target_version.expires_at is null
            or target_version.expires_at >
              pg_catalog.statement_timestamp()
          )
          and nullif(pg_catalog.btrim(source_version.title), '') is not null
          and pg_catalog.lower(
            pg_catalog.regexp_replace(
              pg_catalog.btrim(target_version.title),
              '\s+',
              ' ',
              'g'
            )
          ) = pg_catalog.lower(
            pg_catalog.regexp_replace(
              pg_catalog.btrim(source_version.title),
              '\s+',
              ' ',
              'g'
            )
          )
          and source_assignment.source_type not in (
            'retraining', 'corrective'
          )
          and target_assignment.source_type not in (
            'retraining', 'corrective'
          )
          and source_assignment.status not in ('cancelled', 'superseded')
          and target_assignment.status not in ('cancelled', 'superseded');
      end if;

      if not found or v_shared_identity is null then
        raise exception 'Shared certification completion lineage is invalid';
      end if;
    end if;

    select requirement_version.requirement_kind
    into v_kind
    from learning.requirement_versions requirement_version
    where requirement_version.id = v_requirement_version_id
      and requirement_version.audience = new.audience;

    select coalesce(
      pg_catalog.jsonb_agg(attempt.id order by attempt.id),
      '[]'::jsonb
    )
    into v_attempt_ids
    from learning.attempts attempt
    where attempt.assignment_requirement_id = v_source.id
      and attempt.user_id = new.user_id
      and attempt.audience = new.audience
      and attempt.status = 'passed'
      and attempt.integrity_result = 'valid';

    select coalesce(
      pg_catalog.jsonb_agg(acknowledgment.id order by acknowledgment.id),
      '[]'::jsonb
    )
    into v_acknowledgment_ids
    from learning.policy_acknowledgments acknowledgment
    where acknowledgment.assignment_requirement_id = v_source.id
      and acknowledgment.user_id = new.user_id
      and acknowledgment.audience = new.audience;

    if (v_kind = 'policy' and pg_catalog.jsonb_array_length(
          v_acknowledgment_ids
        ) = 0)
       or (v_kind <> 'policy' and pg_catalog.jsonb_array_length(
          v_attempt_ids
        ) = 0) then
      raise exception 'Certification completion lacks authoritative evidence';
    end if;

    v_evidence := v_evidence || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'assignment_requirement_id', v_target.id,
        'source_assignment_requirement_id', v_source.id,
        'source_requirement_version_id',
          case
            when v_shared_completion_kind is not null
              then v_source.requirement_version_id
            else null
          end,
        'requirement_version_id', v_requirement_version_id,
        'shared_completion_kind', v_shared_completion_kind,
        'shared_completion_identity', v_shared_identity,
        'status', 'passed',
        'attempt_ids', v_attempt_ids,
        'acknowledgment_ids', v_acknowledgment_ids
      ))
    );
  end loop;

  new.evidence_references := v_evidence;
  return new;
end;
$$;

alter function private.validate_certification_completion_evidence()
  owner to postgres;
revoke all on function private.validate_certification_completion_evidence()
  from public, anon, authenticated, service_role;
