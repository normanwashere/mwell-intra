import { useState } from 'react';
import type { WarehouseData } from '@intra/data-kit';
import { BarcodeScanner } from './BarcodeScanner';

export type WarehouseScanContext =
  | 'receive' | 'issue' | 'return' | 'count' | 'putaway' | 'transfer' | 'lookup';

export type ScanResolution =
  | { ok: true; code: string; productId: string; serialNumber?: string; lotId?: string }
  | { ok: false; code: string; errorCode: 'unknown' | 'duplicate' | 'mismatch' | 'invalid_state'; message: string };

interface ResolveWarehouseScanInput {
  data: WarehouseData;
  context: WarehouseScanContext;
  code: string;
  scannedCodes?: readonly string[];
  expectedProductId?: string;
  expectedEventId?: string;
  expectedLocationId?: string;
  expectedBinId?: string | null;
}

const failure = (code: string, errorCode: Extract<ScanResolution, { ok: false }>['errorCode'], message: string): ScanResolution => ({ ok: false, code, errorCode, message });

export function resolveWarehouseScan(input: ResolveWarehouseScanInput): ScanResolution {
  const code = input.code.trim();
  const normalized = code.toLowerCase();
  if (!code) return failure(code, 'unknown', 'Enter or scan a code.');
  if (input.scannedCodes?.some((item) => item.trim().toLowerCase() === normalized)) {
    return failure(code, 'duplicate', `${code} was already scanned for this task.`);
  }

  const unit = input.data.units.find((row) => row.serialNumber.toLowerCase() === normalized);
  const directProduct = input.data.products.find((row) =>
    row.id.toLowerCase() === normalized || row.sku.toLowerCase() === normalized || row.barcode?.toLowerCase() === normalized);
  const lot = input.data.lots.find((row) => row.id.toLowerCase() === normalized || row.lotCode.toLowerCase() === normalized);
  const productId = unit?.productId ?? directProduct?.id ?? lot?.productId;
  if (!productId) return failure(code, 'unknown', `${code} is not recognized as a product, serial, or lot.`);
  if (input.expectedProductId && productId !== input.expectedProductId) {
    return failure(code, 'mismatch', 'The scanned stock does not match the product required for this task.');
  }

  const product = input.data.products.find((row) => row.id === productId);
  if (product?.serialized && !unit && ['issue', 'return', 'count', 'putaway', 'transfer'].includes(input.context)) {
    return failure(code, 'invalid_state', 'Scan the individual device serial, not the product barcode.');
  }
  if (unit) {
    if (input.context === 'issue' && unit.status !== 'in_stock') {
      return failure(code, 'invalid_state', `This device cannot be issued because it is ${unit.status.replace('_', ' ')}.`);
    }
    if (input.context === 'return' && unit.status !== 'issued') {
      return failure(code, 'invalid_state', unit.status === 'returned'
        ? 'This device was already returned.'
        : `This device cannot be returned because it is ${unit.status.replace('_', ' ')}.`);
    }
    if (input.context === 'count' && !['in_stock', 'returned'].includes(unit.status)) {
      return failure(code, 'invalid_state', `This device is not expected in a count because it is ${unit.status.replace('_', ' ')}.`);
    }
    if (['putaway', 'transfer'].includes(input.context) && !['in_stock', 'returned'].includes(unit.status)) {
      return failure(code, 'invalid_state', `This device cannot move because it is ${unit.status.replace('_', ' ')}.`);
    }
    if (input.expectedEventId && unit.eventId !== input.expectedEventId) {
      return failure(code, 'mismatch', 'The serialized unit belongs to a different event or allocation.');
    }
    if (input.expectedLocationId && unit.locationId !== input.expectedLocationId) {
      return failure(code, 'mismatch', 'The serialized unit is not at the required location.');
    }
    if (input.expectedBinId !== undefined && (unit.binId ?? '') !== (input.expectedBinId ?? '')) {
      return failure(code, 'mismatch', 'The serialized unit is not in the required source bin.');
    }
  }

  return {
    ok: true,
    code: unit?.serialNumber ?? directProduct?.barcode ?? directProduct?.sku ?? lot?.lotCode ?? code,
    productId,
    ...(unit ? { serialNumber: unit.serialNumber } : {}),
    ...(lot ? { lotId: lot.id } : unit?.lotId ? { lotId: unit.lotId } : {}),
  };
}

interface WarehouseScanFlowProps extends Omit<ResolveWarehouseScanInput, 'code' | 'scannedCodes'> {
  scannedCodes?: readonly string[];
  onResolved: (resolution: Extract<ScanResolution, { ok: true }>) => void;
  onCancel?: () => void;
  label?: string;
  manualLabel?: string;
  manualActionLabel?: string;
}

export function WarehouseScanFlow({ scannedCodes = [], onResolved, onCancel, label, manualLabel, manualActionLabel, ...rules }: WarehouseScanFlowProps) {
  const [accepted, setAccepted] = useState<string[]>([]);
  const [result, setResult] = useState<ScanResolution | null>(null);
  const detect = (code: string) => {
    const resolution = resolveWarehouseScan({ ...rules, code, scannedCodes: [...scannedCodes, ...accepted] });
    setResult(resolution);
    if (!resolution.ok) return;
    setAccepted((current) => [...current, resolution.code]);
    onResolved(resolution);
  };
  return (
    <div className="space-y-3">
      <BarcodeScanner
        onDetected={detect}
        label={label ?? `Scan for ${rules.context}`}
        manualLabel={manualLabel}
        manualActionLabel={manualActionLabel}
      />
      {result && (result.ok
        ? <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">Scan accepted: {result.code}</p>
        : <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">{result.message}</p>)}
      {accepted.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Accepted scans">{accepted.map((code) => <li key={code} className="rounded-md bg-inset px-2 py-1 font-mono text-xs text-ink">{code}</li>)}</ul>}
      {onCancel && <button type="button" className="btn-ghost w-full justify-center" onClick={onCancel}>Cancel scanning</button>}
    </div>
  );
}
