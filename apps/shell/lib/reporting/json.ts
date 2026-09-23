import { visit } from 'jsonc-parser';
import { ReportingError } from './errors';

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
export const MAX_JSON_DEPTH = 8;

export function parseStrictJson(input: string | Uint8Array, maxBytes = MAX_BODY_BYTES): unknown {
  const invalid = () => { throw new ReportingError('invalid_data'); };
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PAGE_BYTES) invalid();
    const size = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength;
    if (size > maxBytes) invalid();
    const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    if (!text.isWellFormed()) invalid();
    // Stop at the depth boundary during parsing, before allocating a nested tree.
    const stack: Array<Set<string> | null> = [];
    const begin = (keys: Set<string> | null) => {
      if (stack.length >= MAX_JSON_DEPTH) invalid();
      stack.push(keys);
    };
    visit(text, {
      onObjectBegin: () => begin(new Set()),
      onArrayBegin: () => begin(null),
      onObjectEnd: () => { stack.pop(); },
      onArrayEnd: () => { stack.pop(); },
      onObjectProperty: key => {
        const keys = stack[stack.length - 1];
        if (!key.isWellFormed() || !keys || keys.has(key)) invalid();
        keys!.add(key);
      },
      onLiteralValue: value => {
        if (typeof value === 'string' && !value.isWellFormed()) invalid();
        if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) invalid();
      },
      onError: invalid,
    }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReportingError('invalid_data');
  }
}
