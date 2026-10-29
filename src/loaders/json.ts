import { CorruptDocumentError } from '../core/errors.js';
import { baseTitle, decodeText } from './registry.js';
import { groupRows, type Row } from './rows.js';
import type { DocumentLoader } from './types.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Flattens nested values to 'key.path: value' pairs (arrays use [i]). */
export function flatten(value: Json, prefix = ''): [string, string][] {
  if (value === null || typeof value !== 'object') return prefix ? [[prefix, String(value)]] : [];
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return prefix ? [[prefix, value.map(String).join(', ')]] : [];
    }
    return value.flatMap((v, i) => flatten(v, `${prefix}[${i}]`));
  }
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const recordLine = (value: Json) =>
  value !== null && typeof value === 'object'
    ? flatten(value)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
    : String(value);

/**
 * JSON and JSON Lines. An array of records (or one record per line) behaves like CSV rows with
 * 'records a-b' locators; a single object is flattened to 'key.path: value' lines with key locators.
 */
export const jsonLoader: DocumentLoader = {
  name: 'json',
  extensions: ['.json', '.jsonl'],
  async load(input, ctx) {
    const text = decodeText(input.bytes);
    const jsonl = input.extension === '.jsonl';
    let value: Json;
    try {
      value = jsonl
        ? text
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l) as Json)
        : (JSON.parse(text) as Json);
    } catch (error) {
      throw new CorruptDocumentError(input.uri, (error as Error).message, { cause: error });
    }
    const title = baseTitle(input.fileName);
    const format = jsonl ? 'jsonl' : 'json';
    if (Array.isArray(value)) {
      const rows: Row[] = value.map((v, i) => ({ number: i + 1, line: recordLine(v) }));
      const keys = new Set<string>();
      for (const v of value.slice(0, 50)) {
        if (v && typeof v === 'object' && !Array.isArray(v))
          Object.keys(v).forEach((k) => keys.add(k));
      }
      const header = keys.size > 0 ? `Fields: ${[...keys].join(', ')}` : '';
      return {
        title,
        format,
        sections: groupRows(rows, header, ctx, (start, end) => ({ kind: 'records', start, end })),
        metadata: { recordCount: value.length },
      };
    }
    // A single object (or scalar): flattened key paths grouped like rows, located by key range.
    const pairs = flatten(value);
    const rows: Row[] = pairs.map(([k, v], i) => ({ number: i + 1, line: `${k}: ${v}` }));
    const keyAt = (n: number) => pairs[n - 1]?.[0] ?? '';
    return {
      title,
      format,
      sections: groupRows(rows, '', ctx, (start, end) => ({
        kind: 'keys',
        first: keyAt(start),
        last: keyAt(end),
      })),
    };
  },
};
