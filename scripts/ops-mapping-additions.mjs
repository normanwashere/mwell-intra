import { createHash } from 'node:crypto';
import { OPS_CUSTODY_CANDIDATES } from '../modules/learning/src/opsCustodyCandidates.ts';
import { OPS_CUSTODY_CANDIDATE_RULES } from '../modules/learning/src/opsCustodyCandidateAuthority.server.ts';
export const OPS_RULES_HASH = '0353e6083a2f33d426a5078833451dfec6ec804546c022a62d70c605eda4e87f';
export const OPS_HASHES = {
  'warehouse-putaway-review-v1': '444e9c98a0f18cd5099076a5b476b1d93d5fdf23c351dfad481c7d0674a5ba76',
  'warehouse-pick-pack-review-v1': 'd46411fbf73f14c9ef20cc8814e5733bd5fb6cddd65fb2c53c520993a5f31470',
};
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function opsAdditions() {
  if (hash(OPS_CUSTODY_CANDIDATE_RULES) !== OPS_RULES_HASH) throw new Error('Ops review rules drift');
  return OPS_CUSTODY_CANDIDATES.map((content) => {
    if (hash(content) !== OPS_HASHES[content.id]) throw new Error('Ops reviewed content drift');
    return { content, key: `internal.role.warehouse.warehouse_operator.${content.id === 'warehouse-putaway-review-v1' ? 'putaway' : 'pick-pack'}.v1`,
      rules: { required_checkpoints: content.checkpointIds, checkpoint_outcomes: Object.fromEntries(content.embeddedSteps.map((step) => {
        const rule = OPS_CUSTODY_CANDIDATE_RULES[`${content.id}:${step.checkpointId}`];
        if (!rule || !step.choices.some((choice) => choice.id === rule.acceptedChoiceId)) throw new Error('Ops accepted rule missing');
        return [step.checkpointId, [rule.acceptedChoiceId]];
      })) } };
  });
}

// Uses the parent's transaction, reviewed baseline, owner and new curriculum row.
export function renderOpsAdditions(reference) {
  return opsAdditions().map(({ content, key, rules }) => `
  if exists(select 1 from learning.requirements where requirement_key=${q(key)}) then raise exception 'Ops additive root already exists'; end if;
  ${content.capabilityOutcomes.map((o) => `if not exists(select 1 from core.role_capabilities where module='warehouse' and role='warehouse_operator' and cap=${q(o.capability)}) then raise exception 'Ops additive outcome lacks existing role grant'; end if;`).join('\n')}
  select * into strict extra_root from learning.requirements where id=old_r.requirement_id;
  extra_root := jsonb_populate_record(extra_root,jsonb_build_object('id',gen_random_uuid(),'requirement_key',${q(key)},'created_by',owner_actor,'created_at',statement_timestamp()));
  insert into learning.requirements select extra_root.*;
  extra_r := jsonb_populate_record(new_r,jsonb_build_object('id',gen_random_uuid(),'requirement_id',extra_root.id,
    'title',${q(content.title)},'simulation_id',${q(content.id)},'pass_rules',${q(JSON.stringify(rules))}::jsonb,
    'content_reference',${q(`modules/learning/src/opsCustodyCandidates.ts#${content.id}`)},
    'source_references',old_r.source_references||jsonb_build_array(${q(JSON.stringify({ ...reference, simulation_id: content.id,
      content_sha256: OPS_HASHES[content.id], rules_sha256: OPS_RULES_HASH, source: 'modules/learning/src/opsCustodyCandidates.ts' }))}::jsonb)));
  insert into learning.requirement_versions select extra_r.*;
  insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
    select v.id,extra_r.id,'internal',max(sort_order)+1,true,owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id;
  insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
    select id,v.id,extra_r.id,old_r.id,'internal',owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;
  ${content.capabilityOutcomes.map((o) => `insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
    select id,v.id,extra_r.id,'internal','warehouse',${q(o.capability)},owner_actor from learning.curriculum_requirements where curriculum_version_id=v.id and requirement_version_id=extra_r.id;`).join('\n')}
  `).join('\n');
}
