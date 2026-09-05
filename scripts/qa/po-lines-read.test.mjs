import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const ts = require('typescript');
const store = readFileSync(new URL('../../modules/procurement/src/localStore.ts', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../../modules/procurement/src/evidencePresentation.ts', import.meta.url), 'utf8');
function declaration(source, name) {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `actual ${name} declaration`);
  return node.getText(ast).replace(/^export /, '');
}
const code = ts.transpileModule([
  declaration(store, 'useLiveRows'), declaration(store, 'mapPurchaseOrder'),
  declaration(presentation, 'governedReceivedQuantity'), declaration(presentation, 'receiptQuantityLabel'),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

// Execute the actual hook's initial-effect and refresh query paths. Only React's
// state/effect scheduler and the remote transport are replaced for this unit test.
function fixture(initial) {
  let response = initial;
  const state = [], effects = [], queries = [];
  const useState = value => { const index = state.length; state.push(value); return [value, next => { state[index] = next; }]; };
  const api = new Function('useState', 'useEffect', 'useRef', 'useCallback', `${code}; return {useLiveRows,mapPurchaseOrder,receiptQuantityLabel};`)(
    useState, effect => effects.push(effect), current => ({ current }), callback => callback,
  );
  const client = { schema(schema) { return { from(table) {
    const query = {
      select(columns) { queries.push({ schema, table, columns }); return query; },
      order() { return query; },
      then(resolve, reject) { return (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)).then(resolve, reject); },
    };
    return query;
  } }; } };
  const [, , refresh] = api.useLiveRows(client, 'procurement', 'purchase_order_lines', row => row, { column: 'id', ascending: true });
  for (const effect of effects) effect();
  const label = () => {
    const po = api.mapPurchaseOrder({ id: 'po1', status: 'closed', lines: [{ id: 'line1', quantity: 100, receivedQuantity: 999 }] }, undefined, [], undefined, undefined, [], undefined, [], state[0]);
    assert.equal(po.status, 'closed');
    assert.equal(po.paymentReadiness, undefined);
    return api.receiptQuantityLabel(po.lines[0].receivedQuantity, 100);
  };
  return { state, queries, refresh, label, setResponse: value => { response = value; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const good = { data: [{ id: 'line1', purchase_order_id: 'po1', received_quantity: 100 }], error: null };
for (const [name, response] of [
  ['RLS-hidden rows', { data: [], error: null }],
  ['permission denial with partial data', { data: good.data, error: { code: '42501', message: 'permission denied' } }],
  ['transport rejection', new Error('network unavailable')],
  ['missing data', { data: null, error: null }],
  ['wrong PO lineage', { data: [{ ...good.data[0], purchase_order_id: 'other' }], error: null }],
]) {
  test(`${name}: initial and refresh reads never fabricate receipts or retain stale counts`, async () => {
    const f = fixture(response);
    await flush();
    assert.equal(f.label(), 'Unknown / 100');
    assert.equal(f.state[1], false);
    f.setResponse(good);
    await f.refresh();
    assert.equal(f.label(), '100 / 100');
    f.setResponse(response);
    await f.refresh();
    assert.equal(f.label(), 'Unknown / 100');
    assert.equal(f.state[1], false);
    assert.deepEqual(f.queries, Array(3).fill({ schema: 'procurement', table: 'purchase_order_lines', columns: '*' }));
  });
}
test('live PO read and refresh include normalized lines', () => {
  assert.match(store, /live, 'procurement', 'purchase_order_lines'/);
  assert.match(store, /liveMonitoring\.filter\([^]*?livePoLines,\s*\)/);
  assert.match(store, /refreshPos\(\),\s*refreshPoLines\(\)/);
  assert.match(store, /liveRowsLoading \|\|\s*livePoLinesLoading/);
});
