import { describe, expect, it } from 'vitest';
import { parseStrictJson } from './json';

describe('unambiguous reporting JSON', () => {
  it('parses ordinary JSON without changing strings or nulls', () => {
    expect(parseStrictJson('{"amount":"1.00","missing":null,"list":[1,true]}')).toEqual({ amount: '1.00', missing: null, list: [1, true] });
  });
  it.each([
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"a":1,"a":2}}',
    '{"a":1,}', '// comment\n{}', '{/*comment*/}', '{"a":undefined}', '{}{}', '',
    '{"a":1e999}', '{"a":9007199254740993}', '{"a":"\\ud800"}', '{"\\udfff":1}',
    '['.repeat(9) + '0' + ']'.repeat(9),
  ])('rejects ambiguous or invalid input %s', value => {
    expect(() => parseStrictJson(value)).toThrow('Invalid reporting data.');
  });
  it('enforces UTF-8 bytes, not character count, and rejects malformed UTF-8', () => {
    expect(() => parseStrictJson('"' + '\u00e9'.repeat(9000) + '"')).toThrow();
    expect(() => parseStrictJson(new Uint8Array([0x22, 0xc3, 0x28, 0x22]))).toThrow();
  });
  it('fails before unbounded nesting and never leaks the input in errors', () => {
    expect(() => parseStrictJson('['.repeat(7000) + '"PRIVATE"' + ']'.repeat(7000))).toThrow('Invalid reporting data.');
    try { parseStrictJson('{"secret":"PRIVATE",}'); } catch (error) { expect(String(error)).not.toContain('PRIVATE'); }
  });
});
