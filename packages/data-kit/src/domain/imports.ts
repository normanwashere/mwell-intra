export type WarehouseImportKind = 'locations_bins_v1' | 'products_opening_stock_v1';

export interface ImportIssue {
  row: number;
  field: string;
  code: string;
  message: string;
}

export interface ImportValidationResult {
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  issues: ImportIssue[];
  normalizedRows: Record<string, string | number | boolean | null>[];
}

export interface ImportValidationContext {
  knownLocationIds?: readonly string[];
  knownBinKeys?: readonly string[];
}

type RawRow = Record<string, string>;

const HEADERS: Record<WarehouseImportKind, readonly string[]> = {
  locations_bins_v1: [
    'template_version', 'location_external_id', 'location_name', 'location_type',
    'bin_code', 'bin_label', 'zone', 'active',
  ],
  products_opening_stock_v1: [
    'template_version', 'sku', 'product_name', 'category', 'serialized',
    'unit_cost', 'reorder_point', 'location_external_id', 'bin_code',
    'quantity', 'serial_number',
  ],
};

const unsafeFormula = (value: string) => /^[=+\-@]/.test(value.trim());
const text = (value: string | undefined) => (value ?? '').trim();

function issue(row: number, field: string, code: string, message: string): ImportIssue {
  return { row, field, code, message };
}

function parseNumberField(
  value: string | undefined,
  row: number,
  field: string,
  issues: ImportIssue[],
  integer = false,
): number | null {
  const raw = text(value);
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    issues.push(issue(row, field, 'invalid_number', `${field} must be numeric.`));
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    issues.push(issue(row, field, 'invalid_number', `${field} has an invalid numeric value.`));
    return null;
  }
  if (parsed < 0) {
    issues.push(issue(row, field, 'negative_number', `${field} cannot be negative.`));
    return null;
  }
  return parsed;
}

function safeText(
  value: string | undefined,
  row: number,
  field: string,
  issues: ImportIssue[],
  required = true,
): string {
  const normalized = text(value);
  if (required && !normalized) {
    issues.push(issue(row, field, 'required', `${field} is required.`));
  } else if (normalized && unsafeFormula(normalized)) {
    issues.push(issue(row, field, 'unsafe_formula', `${field} cannot begin with a formula marker.`));
  }
  return normalized;
}

export function validateImportRows(
  kind: WarehouseImportKind,
  rows: readonly RawRow[],
  context: ImportValidationContext = {},
): ImportValidationResult {
  const sourceRows = rows.length;
  const batchFailure = (problem: ImportIssue): ImportValidationResult => ({
    sourceRows,
    acceptedRows: 0,
    rejectedRows: sourceRows,
    duplicateRows: 0,
    issues: [problem],
    normalizedRows: [],
  });
  if (sourceRows > 10_000) {
    return batchFailure(issue(0, 'file', 'row_limit', 'Imports cannot exceed 10,000 data rows.'));
  }
  if (sourceRows === 0) {
    return { sourceRows: 0, acceptedRows: 0, rejectedRows: 0, duplicateRows: 0, issues: [], normalizedRows: [] };
  }
  const expectedHeaders = HEADERS[kind];
  const actualHeaders = Object.keys(rows[0] ?? {});
  if (
    actualHeaders.length !== expectedHeaders.length
    || actualHeaders.some((header, index) => header !== expectedHeaders[index])
  ) {
    return batchFailure(issue(1, 'header', 'invalid_headers', `Expected headers: ${expectedHeaders.join(',')}`));
  }
  if (rows.some((row) => text(row.template_version) !== '1')) {
    return batchFailure(issue(0, 'template_version', 'stale_version', 'Template version must be 1.'));
  }

  const issues: ImportIssue[] = [];
  const normalizedRows: ImportValidationResult['normalizedRows'] = [];
  const seen = new Set<string>();
  const seenSerials = new Set<string>();
  const knownLocations = new Set(context.knownLocationIds ?? []);
  const knownBins = new Set(context.knownBinKeys ?? []);
  let rejectedRows = 0;
  let duplicateRows = 0;

  rows.forEach((raw, index) => {
    const row = index + 2;
    const rowIssues: ImportIssue[] = [];
    let duplicateKey = '';
    let normalized: Record<string, string | number | boolean | null>;

    if (kind === 'locations_bins_v1') {
      const locationExternalId = safeText(raw.location_external_id, row, 'location_external_id', rowIssues);
      const locationName = safeText(raw.location_name, row, 'location_name', rowIssues);
      const locationType = safeText(raw.location_type, row, 'location_type', rowIssues);
      const binCode = safeText(raw.bin_code, row, 'bin_code', rowIssues);
      const binLabel = safeText(raw.bin_label, row, 'bin_label', rowIssues, false);
      const zone = safeText(raw.zone, row, 'zone', rowIssues, false);
      const activeRaw = text(raw.active).toLowerCase();
      if (locationType !== 'warehouse') {
        rowIssues.push(issue(row, 'location_type', 'invalid_enum', 'location_type must be warehouse.'));
      }
      if (!['true', 'false'].includes(activeRaw)) {
        rowIssues.push(issue(row, 'active', 'invalid_enum', 'active must be true or false.'));
      }
      duplicateKey = `${locationExternalId}|${binCode}`.toLowerCase();
      normalized = {
        templateVersion: 1, locationExternalId, locationName, locationType,
        binCode, binLabel: binLabel || null, zone: zone || null, active: activeRaw === 'true',
      };
    } else {
      const sku = safeText(raw.sku, row, 'sku', rowIssues);
      const productName = safeText(raw.product_name, row, 'product_name', rowIssues);
      const category = safeText(raw.category, row, 'category', rowIssues);
      const serializedRaw = text(raw.serialized).toLowerCase();
      const unitCost = parseNumberField(raw.unit_cost, row, 'unit_cost', rowIssues);
      const reorderPoint = parseNumberField(raw.reorder_point, row, 'reorder_point', rowIssues, true);
      const locationExternalId = safeText(raw.location_external_id, row, 'location_external_id', rowIssues);
      const binCode = safeText(raw.bin_code, row, 'bin_code', rowIssues);
      const quantity = parseNumberField(raw.quantity, row, 'quantity', rowIssues, true);
      const serialNumber = safeText(raw.serial_number, row, 'serial_number', rowIssues, false);
      if (!['device', 'merchandise'].includes(category)) {
        rowIssues.push(issue(row, 'category', 'invalid_enum', 'category must be device or merchandise.'));
      }
      if (!['true', 'false'].includes(serializedRaw)) {
        rowIssues.push(issue(row, 'serialized', 'invalid_enum', 'serialized must be true or false.'));
      }
      const serialized = serializedRaw === 'true';
      if (serialized && (!serialNumber || quantity !== 1)) {
        rowIssues.push(issue(row, 'serial_number', 'serialized_contract', 'Serialized rows require one serial and quantity 1.'));
      }
      if (!serialized && serialNumber) {
        rowIssues.push(issue(row, 'serial_number', 'serialized_contract', 'Bulk rows cannot include a serial number.'));
      }
      if (context.knownLocationIds && !knownLocations.has(locationExternalId)) {
        rowIssues.push(issue(row, 'location_external_id', 'unknown_parent', 'Location was not found.'));
      }
      if (context.knownBinKeys && !knownBins.has(`${locationExternalId}|${binCode}`)) {
        rowIssues.push(issue(row, 'bin_code', 'unknown_parent', 'Bin was not found under the location.'));
      }
      duplicateKey = `${sku}|${locationExternalId}|${binCode}|${serialNumber}`.toLowerCase();
      if (serialNumber && seenSerials.has(serialNumber.toLowerCase())) duplicateKey = `serial:${serialNumber.toLowerCase()}`;
      normalized = {
        templateVersion: 1, sku, productName, category, serialized,
        unitCost, reorderPoint, locationExternalId, binCode, quantity,
        serialNumber: serialNumber || null,
      };
      if (serialNumber) seenSerials.add(serialNumber.toLowerCase());
    }

    if (seen.has(duplicateKey) || duplicateKey.startsWith('serial:')) {
      duplicateRows += 1;
      issues.push(issue(row, 'row', 'duplicate', 'Duplicate import row or natural key.'));
      return;
    }
    seen.add(duplicateKey);
    if (rowIssues.length > 0) {
      rejectedRows += 1;
      issues.push(...rowIssues);
      return;
    }
    normalizedRows.push(normalized);
  });

  return {
    sourceRows,
    acceptedRows: normalizedRows.length,
    rejectedRows,
    duplicateRows,
    issues,
    normalizedRows,
  };
}
