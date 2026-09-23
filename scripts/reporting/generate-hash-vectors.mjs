import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { default: canonicalize } = await import(pathToFileURL(require.resolve('canonicalize')).href);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const envelope = { record_id: 'product-1', dataset: 'warehouse.products', source_system: 'intra', source_id: 'product-1', source_updated_at: null, data_quality_flags: [] };
const fixtures = [
  ['null', { value: null }], ['absent', {}],
  ['decimal-scale-2', { amount: '12.50', currency: 'PHP' }],
  ['decimal-scale-1', { amount: '12.5', currency: 'PHP' }],
  ['large-decimal', { amount: '12345678901234567890.01' }],
  ['unicode-composed', { value: '\u00e9' }], ['unicode-decomposed', { value: 'e\u0301' }],
  ['unicode-key-order', { '\ue000': 1, '\ud800\udc00': 2 }],
  ['ordered-array', { steps: ['receive', 'inspect', 'store'] }],
  ['reordered-array', { steps: ['inspect', 'receive', 'store'] }],
  ['record-envelope', { ...envelope, quantity: '1.00' }],
  ['quality-flag', { ...envelope, data_quality_flags: ['missing_link'], quantity: '1.00' }],
];
const records = fixtures.map(([name, input]) => ({ name, input, canonical: canonicalize(input), record_hash: sha(canonicalize(input)) }));
const datasets = [[], [
  { record_id: '\ud800\udc00', record_hash: records[0].record_hash },
  { record_id: '\ue000', record_hash: records[1].record_hash },
]].map(rows => {
  const sorted = [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.record_id), Buffer.from(b.record_id)));
  const canonical_lines = sorted.map(row => canonicalize([row.record_id, row.record_hash]) + '\n').join('');
  return { records: rows, record_count: rows.length, canonical_lines, checksum: sha(canonical_lines) };
});
const output = JSON.stringify({ hash_algorithm: 'sha256-jcs-v1', generator: 'canonicalize@5.1.0 + node:crypto SHA-256', records, datasets }, null, 2) + '\n';
const target = new URL('../../docs/integrations/reporting-api/hash-vectors.json', import.meta.url);
if (process.argv.includes('--write')) writeFileSync(target, output);
else if (readFileSync(target, 'utf8') !== output) throw new Error('Reporting hash vectors differ from the pinned generator.');
console.log(`Verified ${records.length} record vectors and ${datasets.length} dataset vectors.`);
