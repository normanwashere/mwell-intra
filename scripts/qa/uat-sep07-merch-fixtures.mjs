export const MERCH_PROJECT = 'kkoitlvydytdhlpxhuah';
export const MERCH_MARKER = 'UAT-SEP07-MERCH-v1';
export const MERCH_NOTE = `${MERCH_MARKER}: preconfigured issued state is explicitly synthetic UAT setup, not actual human approval. Expected arrival 2026-09-08 is a synthetic test date, not confirmed supplier delivery. PHP unit costs are placeholders, not quotations or approval evidence. Linked goods request is setup context, not a completed approval workflow.`;

export function buildSep07MerchFixtures() {
  const products = ['S', 'M', 'L', 'TUMBLER'].map((size, i) => ({
    id: `uat-sep07-${size === 'TUMBLER' ? 'tumbler' : `jacket-${size.toLowerCase()}`}`,
    sku: `UAT-SEP07-${size === 'TUMBLER' ? size : `JACKET-${size}`}`,
    name: size === 'TUMBLER' ? 'UAT Sep7 Tumbler' : `UAT Sep7 Jacket - ${size}`,
    category: 'merchandise', merchandise_type: 'other', serialized: false,
    serialization_policy: 'none', item_class: 'merchandise', uom: 'piece',
    barcode: `MWUAT-SEP07-${size === 'TUMBLER' ? size : `JACKET-${size}`}`,
    attributes: { seed: MERCH_MARKER, ...(i < 3 ? { size } : {}), costBasis: 'synthetic PHP placeholder; not supplier quotation' },
    unit_cost: i < 3 ? 500 : 150, price: i < 3 ? 500 : 150,
    reorder_point: 0, promotional: false, expiry_tracked: false, shelf_life_warning_days: 30,
  }));
  const vendors = ['D', 'E'].map((letter, i) => ({
    id: `a9079000-0000-4000-8000-00000000000${i + 5}`,
    legal_name: `Company ${letter} (synthetic UAT Sep7 supplier)`, trade_name: `Company ${letter}`,
    tin: `${MERCH_MARKER}-${letter}`, category: 'merchandise', accreditation_status: 'draft', owner_module: 'legal',
  }));
  const requests = [], orders = [], lines = [];
  vendors.forEach((v, i) => {
    const ref = `UAT-SEP07-PO-000${i + 5}`, request = `UAT-SEP07-REQ-000${i + 5}`;
    const selected = i === 0 ? products.slice(0, 3) : products.slice(3);
    const poLines = selected.map((p, j) => ({ id: `${ref}-LINE-${j + 1}`, productId: p.id, description: p.name, quantity: i === 0 ? 100 : 300, receivedQuantity: 0, unitPrice: p.unit_cost, uom: 'piece' }));
    const total = poLines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
    requests.push({ id: request, title: `${MERCH_MARKER} Company ${i === 0 ? 'D' : 'E'} merchandise`, description: MERCH_NOTE, department: 'operations', category: 'goods', status: 'draft', core_vendor_id: v.id, vendor_name: v.trade_name, estimated_amount: total, attachments: [], lines: poLines.map(l => ({ ...l, id: l.id.replace(ref, request) })) });
    orders.push({ id: ref, po_number: ref, request_id: request, core_vendor_id: v.id, vendor_name: v.trade_name, status: 'issued', expected_date: '2026-09-08', issued_at: '2026-09-07T08:00:00.000Z', origin: 'procurement', notes: MERCH_NOTE, total, lines: poLines });
    lines.push(...poLines.map((l, j) => ({ id: l.id, purchase_order_id: ref, line_no: j + 1, description: l.description, quantity: l.quantity, uom: l.uom, unit_price: l.unitPrice, received_quantity: 0, warehouse_product_id: l.productId, receiving_status: 'open' })));
  });
  return [
    { schema: 'core', table: 'vendors', rows: vendors, identity: ['legal_name', 'tin'], unique: ['tin', 'trade_name'] },
    { schema: 'warehouse', table: 'suppliers', rows: vendors.map((v, i) => ({ id: `uat-sep07-company-${i === 0 ? 'd' : 'e'}`, name: v.trade_name, lead_time_days: 0 })), identity: ['name'], unique: ['name'] },
    { schema: 'warehouse', table: 'products', rows: products, identity: ['sku', 'barcode', 'serialized', 'serialization_policy', 'attributes'], unique: ['sku', 'barcode'] },
    { schema: 'procurement', table: 'requests', rows: requests, identity: ['description', 'core_vendor_id'], unique: [] },
    { schema: 'procurement', table: 'purchase_orders', rows: orders, identity: ['po_number', 'request_id', 'core_vendor_id', 'notes'], unique: ['po_number'] },
    { schema: 'procurement', table: 'purchase_order_lines', rows: lines, identity: ['purchase_order_id', 'line_no', 'warehouse_product_id'], unique: [] },
  ];
}
