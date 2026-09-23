import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATASET_IDS, getDataset } from './catalog';
import { getDatasetDictionary, parseReportingDictionary, reportingDictionary, reviewedSourceSchema, sourceSchemaFingerprint } from './dictionary';

const root = new URL('../../../../docs/integrations/reporting-api/', import.meta.url);
const input = () => JSON.parse(readFileSync(new URL('dictionary.json', root), 'utf8'));
const metadata = () => JSON.parse(readFileSync(new URL('source-schema.json', root), 'utf8'));

describe('draft reporting dictionary', () => {
  it('covers exactly the 30 catalog IDs without authorizing export', () => {
    expect(reportingDictionary.datasets.map(d => d.id).sort()).toEqual([...DATASET_IDS].sort());
    for (const id of DATASET_IDS) {
      const dataset = getDatasetDictionary(id)!;
      expect(dataset.status).toBe('draft');
      expect(dataset.availability).toBe('not-ready');
      expect(dataset.export_authorized).toBe(false);
      expect(dataset.properties.length).toBeGreaterThan(0);
      expect(dataset.blockers.length).toBeGreaterThan(0);
      expect(getDataset(id)?.availability).toBe('unavailable');
    }
  });

  it('binds UAT-only metadata provenance to its fingerprint', () => {
    expect(reviewedSourceSchema.project_id).toBe('kkoitlvydytdhlpxhuah');
    expect(reviewedSourceSchema.environment).toBe('uat');
    expect(sourceSchemaFingerprint(reviewedSourceSchema.relations)).toBe(reviewedSourceSchema.fingerprint.value);
    expect(reportingDictionary.schema_fingerprint).toBe(reviewedSourceSchema.fingerprint.value);
    expect(reportingDictionary.reviewed_at).toBe(reviewedSourceSchema.reviewed_at);
    expect(reviewedSourceSchema.queries.every(q => q.startsWith('BEGIN READ ONLY;') && q.endsWith('ROLLBACK;'))).toBe(true);
  });

  it.each(['auth.users', '__proto__', 'constructor', 'warehouse.products;select *'])('does not resolve arbitrary ID %s', id => {
    expect(getDatasetDictionary(id)).toBeUndefined();
  });

  it('returns deeply immutable metadata', () => {
    const dataset = getDatasetDictionary('warehouse.products')!;
    expect(Object.isFrozen(reportingDictionary)).toBe(true);
    expect(Object.isFrozen(dataset.properties)).toBe(true);
    expect(Object.isFrozen(dataset.properties[0]!.source)).toBe(true);
  });

  it.each([
    ['missing dataset', (d: ReturnType<typeof input>) => d.datasets.pop()],
    ['duplicate dataset', (d: ReturnType<typeof input>) => { d.datasets[1] = d.datasets[0]; }],
    ['ready dataset', (d: ReturnType<typeof input>) => { d.datasets[0].availability = 'ready'; }],
    ['export approval', (d: ReturnType<typeof input>) => { d.export_authorized = true; }],
    ['unknown property', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].raw_json = {}; }],
    ['JSON catchall', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].type = 'json'; }],
    ['wildcard projection', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].source.column = '*'; }],
    ['missing source', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].source.column = 'not_a_column'; }],
    ['false nullability', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].nullable = true; }],
    ['wrong scalar type', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].type = 'boolean'; }],
    ['envelope shadow', (d: ReturnType<typeof input>) => { d.datasets[0].properties[0].name = 'source_id'; }],
    ['invalid envelope type', (d: ReturnType<typeof input>) => { d.envelope[0].type = 'quality_flags'; }],
    ['invalid envelope nullability', (d: ReturnType<typeof input>) => { d.envelope[0].nullable = true; }],
    ['missing recursive exclusion', (d: ReturnType<typeof input>) => { d.recursive_exclusions.pop(); }],
    ['duplicate field', (d: ReturnType<typeof input>) => { d.datasets[0].properties.push(d.datasets[0].properties[0]); }],
    ['missing exclusions', (d: ReturnType<typeof input>) => { d.datasets[0].exclusions = []; }],
    ['missing blockers', (d: ReturnType<typeof input>) => { d.datasets[0].blockers = []; }],
    ['unbound fingerprint', (d: ReturnType<typeof input>) => { d.schema_fingerprint = '0'.repeat(64); }],
  ])('rejects %s', (_name, mutate) => {
    const draft = input();
    mutate(draft);
    expect(() => parseReportingDictionary(draft, metadata())).toThrow();
  });

  it('rejects source metadata drift and wrong-environment evidence', () => {
    const schema = metadata();
    schema.relations[0].columns[0].nullable = true;
    expect(() => parseReportingDictionary(input(), schema)).toThrow();
    schema.project_id = 'not-uat';
    expect(() => parseReportingDictionary(input(), schema)).toThrow();
  });

  it('requires a positive state predicate and non-null submitted_at for requests', () => {
    for (const mutation of ['unknown_state', 'missing_submission_time']) {
      const draft = input();
      const request = draft.datasets.find((d: { id: string }) => d.id === 'procurement.requests');
      const gate = request.restriction_gates.find((g: { kind: string }) => g.kind === 'private-drafts');
      if (mutation === 'unknown_state') gate.allowed_states.push('future_state');
      else gate.required_non_null = [];
      expect(() => parseReportingDictionary(draft, metadata())).toThrow();
    }
  });

  it('makes every primary/alternate source column explicitly included or excluded', () => {
    for (const dataset of reportingDictionary.datasets) {
      const properties = [...dataset.properties, ...dataset.additional_projections.flatMap(p => p.properties)];
      for (const source of dataset.sources) {
        const relation = reviewedSourceSchema.relations.find(r => r.relation === source)!;
        for (const column of relation.columns) {
          const included = properties.some(p => p.source.relation === source && p.source.column === column.name);
          const excluded = dataset.exclusions.some(e => e.source.relation === source && e.source.column === column.name);
          expect(included !== excluded, `${dataset.id}: ${source}.${column.name}`).toBe(true);
        }
      }
    }
  });

  it('does not misrepresent missing currency, timestamps or authority', () => {
    expect(getDatasetDictionary('warehouse.inventory_positions')!.source_updated_at).toBeNull();
    expect(getDatasetDictionary('warehouse.rekit_work_orders')!.properties.some(p => p.name === 'source_return_case_id')).toBe(true);
    expect(getDatasetDictionary('procurement.quotations')!.properties.every(p => p.type !== 'collection')).toBe(true);
    expect(getDatasetDictionary('procurement.approvals')!.additional_projections[0]!.source_relation).toBe('procurement.purchase_order_amendment_steps');
    for (const dataset of reportingDictionary.datasets) {
      const leaves = dataset.properties.flatMap(p => p.type === 'collection' ? p.properties : [p]);
      if (leaves.some(p => p.currency === 'unresolved')) {
        expect(dataset.blockers.some(b => b.code === 'currency_not_persisted')).toBe(true);
        expect(dataset.availability).toBe('not-ready');
      }
    }
  });

  it.each(['warehouse.department_requests', 'procurement.requests', 'procurement.quotations'])('requires disclosure gates for %s', id => {
    const draft = input();
    draft.datasets.find((d: { id: string }) => d.id === id).restriction_gates = [];
    expect(() => parseReportingDictionary(draft, metadata())).toThrow();
  });

  it.each(['procurement.approvals', 'procurement.purchase_order_lines', 'procurement.amendments', 'procurement.quotations', 'reference.links'])('requires submitted request ancestry for %s', id => {
    const draft = input();
    const dataset = draft.datasets.find((d: { id: string }) => d.id === id);
    dataset.restriction_gates = dataset.restriction_gates.filter((g: { kind: string }) => g.kind !== 'private-drafts');
    expect(() => parseReportingDictionary(draft, metadata())).toThrow();
  });

  it('uses atomic parent-owned child collections, not array-index identity', () => {
    for (const dataset of reportingDictionary.datasets) {
      for (const field of dataset.properties) {
        if (field.type !== 'collection') continue;
        expect(field.additional_properties).toBe(false);
        expect(field.identity).toBe('parent-owned-no-child-id');
        expect(field.update).toBe('replace-atomically');
        expect(field.properties.length).toBeGreaterThan(0);
        expect(field.properties.some(p => p.name === 'id' || p.name === 'index')).toBe(false);
      }
    }
    expect(getDatasetDictionary('warehouse.shipment_events')!.identity.kind).toBe('parent-owned');
    expect(getDatasetDictionary('warehouse.cycle_counts')!.sources).toEqual(['warehouse.cycle_counts']);
  });

  it('rejects unreviewed child properties, reference targets and sensitive columns', () => {
    const draft = input();
    const dataset = draft.datasets.find((d: { id: string }) => d.id === 'warehouse.fulfillment_orders');
    const child = dataset.properties.find((p: { type: string }) => p.type === 'collection');
    child.properties[0].source.path = ['customerEmail'];
    expect(() => parseReportingDictionary(draft, metadata())).toThrow();
    const badReference = input();
    const bin = badReference.datasets.find((d: { id: string }) => d.id === 'warehouse.bins');
    bin.properties.find((p: { name: string }) => p.name === 'location_id').reference.column = 'made_up_id';
    expect(() => parseReportingDictionary(badReference, metadata())).toThrow();
    const pii = input();
    const order = pii.datasets.find((d: { id: string }) => d.id === 'warehouse.fulfillment_orders');
    order.properties[0].source.column = 'customer_email';
    expect(() => parseReportingDictionary(pii, metadata())).toThrow();
  });
});
