import type { Locator, Section } from '../core/types.js';
import type { LoaderContext } from './types.js';

export interface Row {
  /** Row number shown in citations (1-based). */
  number: number;
  line: string;
}

/** 'column: value; column: value', skipping empty values. */
export function serializeRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join('; ');
}

/**
 * Groups consecutive rows into table sections of about targetTokens. The header line (column
 * names) is repeated at the top of every group so each chunk is self-describing. A single row
 * larger than the target becomes its own section (the chunker truncates it above maxTokens).
 */
export function groupRows(
  rows: Row[],
  headerLine: string,
  ctx: LoaderContext,
  locator: (start: number, end: number) => Locator,
  path: string[] = [],
): Section[] {
  const target = ctx.parameters.chunking.targetTokens;
  const headerTokens = headerLine ? ctx.tokens.count(headerLine) : 0;
  const sections: Section[] = [];
  let group: Row[] = [];
  let tokens = headerTokens;
  const flush = () => {
    if (group.length === 0) return;
    const body = group.map((r) => r.line).join('\n');
    sections.push({
      path,
      text: headerLine ? `${headerLine}\n${body}` : body,
      locator: locator(group[0]!.number, group[group.length - 1]!.number),
      modality: 'text',
      kind: 'table',
    });
    group = [];
    tokens = headerTokens;
  };
  for (const row of rows) {
    if (!row.line.trim()) continue;
    const t = ctx.tokens.count(row.line);
    if (group.length > 0 && tokens + t > target) flush();
    group.push(row);
    tokens += t;
  }
  flush();
  return sections;
}
