import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { z } from 'zod';
import dictionaryJson from '../../../../docs/integrations/reporting-api/dictionary.json';
import sourceSchemaJson from '../../../../docs/integrations/reporting-api/source-schema.json';
import { DATASET_IDS, type DatasetId } from './catalog';

const text = z.string().min(1);
const identifier = z.string().regex(/^[a-z][a-z0-9_]*$/);
const relationName = z.string().regex(/^(warehouse|procurement|core)\.[a-z][a-z0-9_]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scalarType = z.enum(['opaque_id', 'string', 'boolean', 'integer', 'decimal_string', 'date', 'timestamp']);
const columnSource = z.strictObject({
  relation: relationName,
  column: identifier,
  path: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/)).max(1),
});
const reference = z.strictObject({
  relation: relationName,
  column: identifier,
  dataset: z.enum(DATASET_IDS).nullable(),
  integrity: z.enum(['foreign-key', 'unconstrained', 'json-contract']),
  meaning: text,
});
const scalarField = z.strictObject({
  name: identifier,
  type: scalarType,
  nullable: z.boolean(),
  meaning: text,
  sensitivity: z.enum(['internal', 'commercial']),
  unit: text.nullable(),
  currency: z.literal('unresolved').nullable(),
  reference: reference.nullable(),
  source: columnSource,
  enum_values: z.array(text).length(0),
});
const collectionField = z.strictObject({
  name: identifier,
  type: z.literal('collection'),
  nullable: z.boolean(),
  meaning: text,
  sensitivity: z.literal('internal'),
  source: columnSource,
  additional_properties: z.literal(false),
  identity: z.literal('parent-owned-no-child-id'),
  update: z.literal('replace-atomically'),
  order: z.literal('source-order'),
  properties: z.array(scalarField).min(1),
  excluded_properties: z.array(text),
  shape_evidence: text,
});
const field = z.union([scalarField, collectionField]);
const identity = z.strictObject({
  kind: z.enum(['persisted-key', 'parent-owned', 'composite-candidate']),
  columns: z.array(columnSource).min(1),
  meaning: text,
});
const datasetSchema = z.strictObject({
  id: z.enum(DATASET_IDS),
  status: z.literal('draft'),
  availability: z.literal('not-ready'),
  export_authorized: z.literal(false),
  sources: z.array(relationName).min(1),
  grain: text,
  identity,
  source_updated_at: columnSource.nullable(),
  properties: z.array(field).min(1),
  additional_projections: z.array(z.strictObject({
    source_relation: relationName,
    identity: columnSource,
    properties: z.array(scalarField).min(1),
  })),
  exclusions: z.array(z.strictObject({ source: columnSource, reason: text })),
  restriction_gates: z.array(z.strictObject({
    kind: z.enum(['private-drafts', 'sealed-bids', 'dependency-disclosure']),
    status: z.literal('blocked'),
    source_columns: z.array(columnSource),
    required_non_null: z.array(columnSource),
    allowed_states: z.array(text),
    requirement: text,
  })).min(1),
  blockers: z.array(z.strictObject({ code: identifier, reason: text })).min(1),
});

const relationSchema = z.strictObject({
  relation: relationName,
  kind: z.enum(['r', 'p', 'v', 'm']),
  rls_enabled: z.boolean(),
  rls_forced: z.boolean(),
  view_options: z.array(text),
  view_definition: text.nullable(),
  columns: z.array(z.strictObject({ name: identifier, postgres_type: text, nullable: z.boolean() })).min(1),
  constraints: z.array(z.strictObject({ name: identifier, kind: z.enum(['p', 'u', 'f', 'c']), definition: text })),
});
const sourceSchema = z.strictObject({
  version: z.literal(1),
  environment: z.literal('uat'),
  project_id: z.literal('kkoitlvydytdhlpxhuah'),
  base_commit: z.literal('96f75f9'),
  reviewed_at: z.iso.datetime(),
  started_at: z.iso.datetime(),
  method: text,
  fingerprint: z.strictObject({ algorithm: z.literal('sha256-jcs-relations-v1'), value: hash }),
  queries: z.array(text).min(1),
  relations: z.array(relationSchema).min(1),
  child_contracts: z.array(z.strictObject({
    relation: relationName,
    column: identifier,
    evidence: text,
    properties: z.array(z.strictObject({ name: text, type: scalarType, nullable: z.literal(true) })).min(1),
    runtime_shape_verified: z.literal(false),
  })),
  missing_relations: z.array(z.strictObject({ relation: relationName, reason: text })),
  limitations: z.array(text).min(1),
});
const exclusions = ['raw_json', 'pdf_and_documents', 'pii', 'contact_details', 'bank_and_tax', 'secrets_and_tokens', 'signed_urls', 'unreviewed_free_text'] as const;
const envelopeNames = ['record_id', 'dataset', 'source_system', 'source_id', 'source_updated_at', 'record_hash', 'data_quality_flags'] as const;
const dictionarySchema = z.strictObject({
  version: z.literal('1-draft'),
  status: z.literal('draft'),
  environment: z.literal('uat'),
  base_commit: z.literal('96f75f9'),
  reviewed_at: z.iso.datetime(),
  schema_fingerprint: hash,
  export_authorized: z.literal(false),
  infrastructure: z.literal('pending'),
  public_projection: z.literal('explicit-properties-only'),
  additional_properties: z.literal(false),
  recursive_exclusions: z.array(z.enum(exclusions)),
  quality_flags: z.array(z.enum(['unresolved_reference', 'source_time_not_recorded', 'source_shape_unverified'])),
  envelope: z.array(z.strictObject({
    name: z.enum(envelopeNames),
    type: z.enum(['opaque_id', 'dataset_id', 'string', 'timestamp', 'sha256', 'quality_flags']),
    nullable: z.boolean(),
    meaning: text,
    source: text,
    sensitivity: z.literal('internal'),
    unit: z.null(),
    currency: z.null(),
    reference: z.null(),
  })),
  datasets: z.array(datasetSchema).length(DATASET_IDS.length),
});

export type ReportingDictionary = z.infer<typeof dictionarySchema>;
export type DatasetDictionary = z.infer<typeof datasetSchema>;
export type ReviewedSourceSchema = z.infer<typeof sourceSchema>;
export type DictionaryField = z.infer<typeof field>;
type Source = z.infer<typeof columnSource>;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

function immutable<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

// Separate from record hashes: this covers schema descriptors only, not authority.
export function sourceSchemaFingerprint(relations: unknown): string {
  const checked = z.array(relationSchema).parse(relations);
  return createHash('sha256').update(canonicalize(checked)!, 'utf8').digest('hex');
}

function requireMapping(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(`Invalid draft reporting dictionary: ${reason}`);
}

function unique(values: readonly string[], context: string) {
  requireMapping(new Set(values).size === values.length, `duplicate ${context}`);
}

function parseSourceSchema(input: unknown): ReviewedSourceSchema {
  const schema = sourceSchema.parse(input);
  unique(schema.relations.map(r => r.relation), 'source relation');
  for (const relation of schema.relations) unique(relation.columns.map(c => c.name), 'source column');
  requireMapping(sourceSchemaFingerprint(schema.relations) === schema.fingerprint.value, 'schema fingerprint mismatch');
  return schema;
}

const forbidden = /(^|_)(email|contact|address|actor|password|token|secret|bank|tin|signature|pdf|notes?|reason|description|justification|evidence|attachments?|payload)(_|$)|(_by$)|^assigned_to$|^customer_|^handover_recipient|storage_path|_url$/i;
const reviewedNonPersonalScalars = new Set([
  'warehouse.customer_return_cases.customer_closed_at',
  'procurement.requests.needed_by',
  'procurement.purchase_orders.acceptance_evidence_version',
  'procurement.payment_readiness_packs.acceptance_evidence_version',
  'procurement.payment_readiness_packs.evidence_stale',
  'procurement.payment_readiness_packs.evidence_stale_at',
]);
const compatible: Record<z.infer<typeof scalarType>, RegExp> = {
  opaque_id: /^(text|uuid)$/,
  string: /^text$/,
  boolean: /^boolean$/,
  integer: /^integer$/,
  decimal_string: /^(integer|bigint|numeric(?:\(\d+,\d+\))?)$/,
  date: /^date$/,
  timestamp: /^timestamp with time zone$/,
};

/** Validate documentation, not business rows. This never grants capture/API access. */
export function parseReportingDictionary(input: unknown, metadata: unknown = sourceSchemaJson): DeepReadonly<ReportingDictionary> {
  const schema = parseSourceSchema(metadata);
  const dictionary = dictionarySchema.parse(input);
  requireMapping(dictionary.schema_fingerprint === schema.fingerprint.value, 'dictionary fingerprint mismatch');
  requireMapping(dictionary.reviewed_at === schema.reviewed_at, 'review time mismatch');
  unique(dictionary.datasets.map(d => d.id), 'dataset');
  unique(dictionary.envelope.map(f => f.name), 'envelope field');
  requireMapping(envelopeNames.every(name => dictionary.envelope.some(f => f.name === name)), 'missing envelope field');
  const envelopeTypes = { record_id: 'opaque_id', dataset: 'dataset_id', source_system: 'string', source_id: 'opaque_id', source_updated_at: 'timestamp', record_hash: 'sha256', data_quality_flags: 'quality_flags' } as const;
  for (const property of dictionary.envelope) {
    requireMapping(property.type === envelopeTypes[property.name] && property.nullable === (property.name === 'source_updated_at'), 'invalid envelope type/nullability');
  }
  unique(dictionary.recursive_exclusions, 'recursive exclusion');
  requireMapping(exclusions.every(e => dictionary.recursive_exclusions.includes(e)), 'missing recursive exclusion');
  const relationMap = new Map(schema.relations.map(r => [r.relation, r]));
  const column = (source: Source) => {
    const result = relationMap.get(source.relation)?.columns.find(c => c.name === source.column);
    requireMapping(Boolean(result), `unreviewed source ${source.relation}.${source.column}`);
    return result!;
  };
  const checkScalar = (property: z.infer<typeof scalarField>, child = false) => {
    const source = column(property.source);
    const reviewedScalar = reviewedNonPersonalScalars.has(`${property.source.relation}.${property.source.column}`);
    requireMapping(reviewedScalar || !forbidden.test(property.source.column), `excluded sensitive column ${property.source.column}`);
    if (!child) {
      requireMapping(property.source.path.length === 0, 'scalar JSON paths require a parent collection');
      requireMapping(compatible[property.type].test(source.postgres_type), `incompatible type for ${property.name}`);
      requireMapping(property.nullable === source.nullable, `incorrect nullability for ${property.name}`);
    }
    if (property.type === 'decimal_string') requireMapping(property.unit !== null, `unit missing for ${property.name}`);
    if (property.currency) requireMapping(property.type === 'decimal_string' && property.sensitivity === 'commercial', 'money requires a commercial decimal string');
    if (property.reference) {
      const target = property.reference;
      column({ ...target, path: [] });
      requireMapping(property.type === 'opaque_id', 'reference must be an opaque ID');
      if (target.dataset) requireMapping(dictionary.datasets.find(d => d.id === target.dataset)!.sources.includes(target.relation), 'reference dataset/source mismatch');
      if (target.integrity === 'foreign-key') {
        requireMapping(relationMap.get(property.source.relation)!.constraints.some(c => c.kind === 'f' && c.definition.includes(`FOREIGN KEY (${property.source.column}) REFERENCES ${target.relation}(${target.column})`)), 'unverified foreign key');
      }
      requireMapping(child === (target.integrity === 'json-contract'), 'incorrect reference evidence kind');
    }
  };
  const checkProperties = (properties: z.infer<typeof field>[], sources: string[]) => {
    unique(properties.map(p => p.name), 'projection field');
    for (const property of properties) {
      requireMapping(!envelopeNames.some(name => name === property.name), 'business field shadows envelope');
      requireMapping(sources.includes(property.source.relation), 'projection references undeclared relation');
      if (property.type !== 'collection') { checkScalar(property); continue; }
      const source = column(property.source);
      requireMapping(source.postgres_type === 'jsonb' && source.nullable === property.nullable && property.source.path.length === 0, 'invalid collection source');
      const contract = schema.child_contracts.find(c => c.relation === property.source.relation && c.column === property.source.column);
      requireMapping(Boolean(contract) && contract!.evidence === property.shape_evidence, 'missing child shape evidence');
      unique(property.properties.map(p => p.name), 'child property');
      for (const child of property.properties) {
        checkScalar(child, true);
        requireMapping(child.source.relation === property.source.relation && child.source.column === property.source.column && child.source.path.length === 1, 'child escaped parent source');
        const key = child.source.path[0]!;
        requireMapping(!forbidden.test(key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)), 'sensitive child property');
        const evidence = contract!.properties.find(p => p.name === key);
        requireMapping(Boolean(evidence) && evidence!.type === child.type && child.nullable, 'unreviewed child property/type/nullability');
        requireMapping(!property.excluded_properties.includes(key) && !['id', 'index'].includes(child.name), 'excluded or fabricated child identity');
      }
    }
  };

  for (const dataset of dictionary.datasets) {
    unique(dataset.sources, 'dataset source');
    requireMapping(dataset.sources.every(r => relationMap.has(r)), 'missing dataset source');
    requireMapping(dataset.blockers.some(b => b.code === 'release_authority_unverified'), 'missing release blocker');
    requireMapping(dataset.restriction_gates.some(g => g.kind === 'dependency-disclosure'), 'missing dependency disclosure gate');
    for (const gate of dataset.restriction_gates) {
      for (const source of [...gate.source_columns, ...gate.required_non_null]) {
        column(source);
        requireMapping(source.path.length === 0, 'gate must use a reviewed scalar column');
      }
      if (gate.kind === 'private-drafts') {
        const state = gate.source_columns.find(s => s.column === 'status' || s.column === 'accreditation_status');
        requireMapping(Boolean(state), 'missing state predicate');
        const relation = relationMap.get(state!.relation)!;
        requireMapping(gate.allowed_states.length > 0 && !gate.allowed_states.includes('draft'), 'missing positive non-draft state predicate');
        requireMapping(gate.allowed_states.every(value => /^[a-z_]+$/.test(value) && relation.constraints.some(c => c.kind === 'c' && c.definition.includes(state!.column) && c.definition.includes(`'${value}'::text`))), 'unknown draft-gate state');
        if (state!.relation === 'procurement.requests') requireMapping(gate.required_non_null.some(s => s.relation === 'procurement.requests' && s.column === 'submitted_at'), 'missing submitted-at predicate');
      }
    }
    if ((dataset.id.startsWith('procurement.') && dataset.id !== 'procurement.suppliers') || dataset.id === 'reference.links') {
      requireMapping(dataset.restriction_gates.some(g => g.kind === 'private-drafts' && g.source_columns.some(s => s.relation === 'procurement.requests' && s.column === 'status') && g.required_non_null.some(s => s.relation === 'procurement.requests' && s.column === 'submitted_at')), 'missing submitted request ancestry gate');
    }
    for (const source of dataset.identity.columns) {
      column(source);
      requireMapping(dataset.sources.includes(source.relation) && source.path.length === 0, 'identity outside source');
    }
    if (dataset.identity.kind !== 'composite-candidate') {
      requireMapping(dataset.identity.columns.length === 1, 'persisted/parent key must be singular');
      const key = dataset.identity.columns[0]!;
      requireMapping(relationMap.get(key.relation)!.constraints.some(c => c.kind === 'p' && c.definition === `PRIMARY KEY (${key.column})`), 'identity is not a persisted primary key');
    }
    if (dataset.source_updated_at) {
      const source = dataset.source_updated_at;
      requireMapping(dataset.sources.includes(source.relation) && source.column === 'updated_at' && source.path.length === 0 && column(source).postgres_type === 'timestamp with time zone', 'synthetic or invalid source update time');
    }
    checkProperties(dataset.properties, [dataset.sources[0]!]);
    for (const projection of dataset.additional_projections) {
      requireMapping(dataset.sources.includes(projection.source_relation), 'undeclared alternate source');
      requireMapping(projection.identity.relation === projection.source_relation && projection.identity.path.length === 0, 'invalid alternate identity');
      column(projection.identity);
      requireMapping(relationMap.get(projection.source_relation)!.constraints.some(c => c.kind === 'p' && c.definition === `PRIMARY KEY (${projection.identity.column})`), 'alternate identity is not persisted');
      checkProperties(projection.properties, [projection.source_relation]);
    }
    const properties = [...dataset.properties, ...dataset.additional_projections.flatMap(p => p.properties)];
    const leaves = properties.flatMap(p => p.type === 'collection' ? p.properties : [p]);
    if (properties.some(p => p.type === 'collection')) requireMapping(dataset.blockers.some(b => b.code === 'child_shape_not_verified'), 'missing child validation blocker');
    if (leaves.some(p => p.currency === 'unresolved')) requireMapping(dataset.blockers.some(b => b.code === 'currency_not_persisted'), 'missing currency blocker');
    for (const excluded of dataset.exclusions) {
      column(excluded.source);
      requireMapping(dataset.sources.includes(excluded.source.relation) && excluded.source.path.length === 0, 'invalid exclusion source');
      requireMapping(!properties.some(p => p.source.relation === excluded.source.relation && p.source.column === excluded.source.column), 'excluded column in projection');
    }
    for (const name of dataset.sources) {
      const relation = relationMap.get(name)!;
      for (const source of relation.columns) {
        requireMapping(properties.some(p => p.source.relation === name && p.source.column === source.name) || dataset.exclusions.some(e => e.source.relation === name && e.source.column === source.name), `column lacks explicit inclusion/exclusion: ${name}.${source.name}`);
      }
      if (relation.constraints.some(c => c.kind === 'c' && c.definition.includes("'draft'::text"))) {
        const stateColumn = name === 'core.vendors' ? 'accreditation_status' : 'status';
        requireMapping(dataset.restriction_gates.some(g => g.kind === 'private-drafts' && g.source_columns.some(s => s.relation === name && s.column === stateColumn)), `missing private draft gate for ${name}`);
      }
    }
    if (['procurement.quotations', 'procurement.sourcing_events'].includes(dataset.id)) {
      requireMapping(dataset.restriction_gates.some(g => g.kind === 'sealed-bids' && g.allowed_states.length === 0), 'missing fail-closed sealed bid gate');
      requireMapping(dataset.blockers.some(b => b.code === 'opening_interlock_unverified'), 'missing opening interlock blocker');
    }
  }
  return immutable(dictionary);
}

export const reviewedSourceSchema = immutable(parseSourceSchema(sourceSchemaJson));
export const reportingDictionary = parseReportingDictionary(dictionaryJson);
const dictionaryById = new Map<DatasetId, DeepReadonly<DatasetDictionary>>(reportingDictionary.datasets.map(dataset => [dataset.id, dataset]));

/** Read-only proposed metadata. Undefined for unregistered IDs; never enables a dataset. */
export function getDatasetDictionary(id: string): DeepReadonly<DatasetDictionary> | undefined {
  return dictionaryById.get(id as DatasetId);
}
