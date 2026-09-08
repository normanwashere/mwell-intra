import { buildSep07MerchFixtures } from './uat-sep07-merch-fixtures.mjs';

export const SEP08_GROUPS = [
  { key: 'VERIFY', jacketQuantity: 20, tumblerQuantity: 1000, purpose: 'automated receiving-to-release verification only; intended receipt 1000 tumblers and release 10 tumblers, retaining 990 accepted units' },
  { key: 'TESTER1', jacketQuantity: 100, tumblerQuantity: 300, purpose: 'untouched repeat tester capacity 1' },
  { key: 'TESTER2', jacketQuantity: 100, tumblerQuantity: 300, purpose: 'untouched repeat tester capacity 2' },
];
export const SEP08_LOCATION = 'uat-aug24-pasig-main';
export const SEP08_BINS = { putaway: 'uat-sep08-verify-storage' };

export function buildSep08MerchFixtures() {
  const base = buildSep07MerchFixtures();
  const get = table => base.find(f => f.table === table);
  const tables = ['products', 'requests', 'purchase_orders', 'purchase_order_lines'].map(table => ({ ...get(table), rows: [] }));
  const rows = table => tables.find(f => f.table === table).rows;
  for (const group of SEP08_GROUPS) {
    const prefix = `UAT-SEP08-${group.key}`, lower = prefix.toLowerCase();
    const note = `${prefix}-v1: ${group.purpose}. Preconfigured issued state is synthetic UAT setup, not actual human approval. Expected arrival 2026-09-08 and PHP costs are synthetic placeholders, not delivery confirmation or supplier quotes. Linked draft goods request is setup context, not approval evidence.`;
    const productIds = new Map();
    for (const p of get('products').rows) {
      const suffix = p.id.slice('uat-sep07-'.length), id = `${lower}-${suffix}`;
      productIds.set(p.id, id);
      rows('products').push({ ...p, id, sku: `${prefix}-${suffix.toUpperCase()}`, barcode: `MW${prefix}-${suffix.toUpperCase()}`, name: `${prefix} ${p.name.slice('UAT Sep7 '.length)}`, attributes: { ...p.attributes, seed: `${prefix}-v1`, purpose: group.purpose } });
    }
    get('purchase_orders').rows.forEach((po, index) => {
      const suffix = index === 0 ? '0005' : '0006', id = `${prefix}-PO-${suffix}`, requestId = `${prefix}-REQ-${suffix}`;
      const quantity = index === 0 ? group.jacketQuantity : group.tumblerQuantity;
      const poLines = po.lines.map((l, j) => ({ ...l, id: `${id}-LINE-${j + 1}`, productId: productIds.get(l.productId), description: `${prefix} ${l.description.slice('UAT Sep7 '.length)}`, quantity, receivedQuantity: 0 }));
      const total = poLines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
      rows('requests').push({ ...get('requests').rows[index], id: requestId, title: `${prefix} ${po.vendor_name} merchandise`, description: note, estimated_amount: total, lines: poLines.map(l => ({ ...l, id: l.id.replace(id, requestId) })) });
      rows('purchase_orders').push({ ...po, id, po_number: id, request_id: requestId, notes: note, total, lines: poLines, issued_at: '2026-09-08T08:00:00.000Z' });
      rows('purchase_order_lines').push(...poLines.map((l, j) => ({ id: l.id, purchase_order_id: id, line_no: j + 1, description: l.description, quantity: l.quantity, uom: l.uom, unit_price: l.unitPrice, received_quantity: 0, warehouse_product_id: l.productId, receiving_status: 'open' })));
    });
  }
  return [{ schema: 'warehouse', table: 'storage_areas', identity: ['location_id', 'code', 'label', 'zone'], unique: ['code'], rows: [
    { id: SEP08_BINS.putaway, location_id: SEP08_LOCATION, code: 'S8V-STOCK', label: 'Sep8 verification putaway and release only', zone: 'UAT-SEP08-VERIFY-v1', active: true },
  ] }, ...tables];
}
