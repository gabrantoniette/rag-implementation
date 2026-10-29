import { parse } from 'csv-parse/sync';
import { CorruptDocumentError } from '../core/errors.js';
import { baseTitle, decodeText } from './registry.js';
import { groupRows, serializeRecord } from './rows.js';
import type { DocumentLoader } from './types.js';

/**
 * CSV and TSV. Each data row becomes 'column: value; ...'; rows are grouped to the target size with
 * the column list repeated. Row numbers count data rows from 1 (the header row is not counted).
 * relax_column_count keeps short rows and drops fields beyond the header.
 */
export const csvLoader: DocumentLoader = {
  name: 'csv',
  extensions: ['.csv', '.tsv'],
  async load(input, ctx) {
    const tsv = input.extension === '.tsv';
    let records: Record<string, string>[];
    try {
      records = parse(decodeText(input.bytes), {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_column_count: true,
        delimiter: tsv ? '\t' : ',',
      }) as Record<string, string>[];
    } catch (error) {
      throw new CorruptDocumentError(input.uri, (error as Error).message, { cause: error });
    }
    const columns = records[0] ? Object.keys(records[0]) : [];
    const rows = records.map((record, i) => ({ number: i + 1, line: serializeRecord(record) }));
    return {
      title: baseTitle(input.fileName),
      format: tsv ? 'tsv' : 'csv',
      sections: groupRows(rows, `Columns: ${columns.join(', ')}`, ctx, (start, end) => ({
        kind: 'rows',
        start,
        end,
      })),
      metadata: { rowCount: records.length },
    };
  },
};
