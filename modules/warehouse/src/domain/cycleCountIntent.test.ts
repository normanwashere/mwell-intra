import { describe, expect, it, vi } from 'vitest';
import { completeCycleCountIntent, cycleCountIntentKey, readCycleCountIntent, retainCycleCountIntent, type CycleCountCommand } from './cycleCountIntent';

const command = (): CycleCountCommand => ({
  idempotencyKey: 'atomic-count-persistence-test', cycleCountId: 'cc-persistence-test',
  locationId: 'warehouse', binId: 'bin', category: 'merchandise', actor: 'counter', requesterId: 'counter-id',
  lines: [{ productId: 'product', expected: 10, counted: 8 }],
  reason: 'Scheduled cycle count', evidenceUrls: ['evidence/count.jpg'],
});
const key = cycleCountIntentKey('supabase', 'counter-id');

describe('cycle-count retained command', () => {
  it('persists an isolated copy of every command field and clears only an exact confirmed command', () => {
    const input = command();
    const retained = retainCycleCountIntent(key, input);
    input.lines[0]!.counted = 4;
    input.evidenceUrls.push('different-evidence');
    expect(readCycleCountIntent(key)).toEqual(retained);
    expect(() => retainCycleCountIntent(key, input)).toThrow(/different saved count/i);
    expect(() => completeCycleCountIntent(key, input)).toThrow(/could not be verified/i);
    expect(readCycleCountIntent(key)).toEqual(retained);
    completeCycleCountIntent(key, retained);
    expect(readCycleCountIntent(key)).toBeNull();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('does not retain an invalid quantity (%s)', counted => {
    const input = command();
    input.lines[0]!.counted = counted;
    expect(() => retainCycleCountIntent(key, input)).toThrow();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('rejects invalid or inconsistent per-lot observations before retaining them', () => {
    const input = command();
    input.lines[0]!.lotCounts = [{ lotId: 'receipt', counted: 7 }, { lotId: null, counted: 0 }];
    expect(() => retainCycleCountIntent(key, input)).toThrow();
    expect(localStorage.getItem(key)).toBeNull();
    input.lines[0]!.lotCounts = [{ lotId: 'receipt', counted: 4 }, { lotId: 'receipt', counted: 4 }];
    expect(() => retainCycleCountIntent(key, input)).toThrow();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps corrupt recovery data and refuses to replace it with another command', () => {
    localStorage.setItem(key, '{damaged');
    expect(() => readCycleCountIntent(key)).toThrow(/could not be verified/i);
    expect(() => retainCycleCountIntent(key, command())).toThrow();
    expect(localStorage.getItem(key)).toBe('{damaged');
  });

  it('isolates data source and signed-in identity without clearing another counter history', () => {
    retainCycleCountIntent(key, command());
    expect(readCycleCountIntent(cycleCountIntentKey('supabase', 'another-counter'))).toBeNull();
    expect(readCycleCountIntent(cycleCountIntentKey('memory', 'counter-id'))).toBeNull();
    expect(readCycleCountIntent(key)).toEqual(command());
  });

  it('fails closed when durable browser storage is unavailable', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Storage quota exceeded'); });
    expect(() => retainCycleCountIntent(key, command())).toThrow('Storage quota exceeded');
    expect(localStorage.getItem(key)).toBeNull();
    write.mockRestore();
  });
});
