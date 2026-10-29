import { parseOffice } from 'officeparser';
import { ArchiveLimitError, CorruptDocumentError } from '../core/errors.js';
import type { Section } from '../core/types.js';
import { baseTitle } from './registry.js';
import { groupRows, type Row } from './rows.js';
import type { DocumentLoader, LoadedContent, LoaderContext, LoaderInput } from './types.js';

/** The subset of officeparser's AST node this loader reads (verified against officeparser 8.4). */
interface OfficeNode {
  type: string;
  text?: string | null;
  children?: OfficeNode[];
  notes?: (OfficeNode | null)[];
  metadata?: Record<string, unknown>;
}

/** Safe archive limits for untrusted Office files (officeparser defaults are 512 MB / 10,000). */
export const OFFICE_LIMITS = {
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxZipEntries: 5_000,
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Text of a node: its own text, or its children's text joined. */
function textOf(node: OfficeNode | null | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string' && node.text.trim()) return clean(node.text);
  return clean((node.children ?? []).map(textOf).join(' '));
}

/** Footnotes, endnotes and speaker notes attached anywhere below this node. */
function notesOf(node: OfficeNode): string[] {
  const own = (node.notes ?? []).map(textOf).filter(Boolean);
  return [...own, ...(node.children ?? []).flatMap(notesOf)];
}

function tableLines(table: OfficeNode): string[] {
  return (table.children ?? [])
    .filter((r) => r.type === 'row')
    .map((r) => (r.children ?? []).map(textOf).filter(Boolean).join(' | '))
    .filter(Boolean);
}

function docxSections(content: OfficeNode[]): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let paragraphs: string[] = [];
  const flush = () => {
    const text = paragraphs.join('\n\n').trim();
    if (text) {
      const path = stack.map((h) => h.title);
      sections.push({
        path,
        text,
        locator: { kind: 'heading', path },
        modality: 'text',
        kind: 'prose',
      });
    }
    paragraphs = [];
  };
  const visit = (node: OfficeNode) => {
    if (node.type === 'heading') {
      flush();
      const level = Number(node.metadata?.level ?? 1);
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title: textOf(node) });
      return;
    }
    if (node.type === 'table') {
      const lines = tableLines(node);
      if (lines.length > 0) paragraphs.push(lines.join('\n'));
      return;
    }
    if (node.type === 'list') {
      const items = (node.children ?? []).map(textOf).filter(Boolean);
      if (items.length > 0) paragraphs.push(items.map((i) => `- ${i}`).join('\n'));
      return;
    }
    const text = textOf(node);
    const notes = notesOf(node).map((n) => `[Footnote: ${n}]`);
    if (text || notes.length > 0) paragraphs.push([text, ...notes].filter(Boolean).join(' '));
  };
  content.forEach(visit);
  flush();
  return sections;
}

function xlsxSections(content: OfficeNode[], ctx: LoaderContext): Section[] {
  const sections: Section[] = [];
  for (const sheet of content.filter((n) => n.type === 'sheet')) {
    const name = String(sheet.metadata?.sheetName ?? 'Sheet');
    const rows = (sheet.children ?? []).filter((r) => r.type === 'row');
    const cells = (row: OfficeNode) =>
      (row.children ?? []).map((c) => ({
        col: Number(c.metadata?.col ?? 0),
        row: Number(c.metadata?.row ?? 0),
        value: textOf(c),
      }));
    const headerRow = rows.find((r) => cells(r).some((c) => c.value));
    if (!headerRow) continue;
    const header = new Map(cells(headerRow).map((c) => [c.col, c.value]));
    const columnName = (col: number) => header.get(col) || String.fromCharCode(65 + (col % 26));
    const dataRows: Row[] = rows
      .filter((r) => r !== headerRow)
      .map((r) => {
        const cs = cells(r).filter((c) => c.value);
        return {
          // Sheet row numbers as Excel shows them (1-based; the header is usually row 1).
          number: (cs[0]?.row ?? 0) + 1,
          line: cs.map((c) => `${columnName(c.col)}: ${c.value}`).join('; '),
        };
      })
      .filter((r) => r.line);
    const headerLine = `Sheet '${name}' columns: ${[...header.values()].filter(Boolean).join(', ')}`;
    sections.push(
      ...groupRows(dataRows, headerLine, ctx, (start, end) => ({
        kind: 'rows',
        start,
        end,
        sheet: name,
      })),
    );
  }
  return sections;
}

function pptxSections(content: OfficeNode[]): Section[] {
  const sections: Section[] = [];
  content
    .filter((n) => n.type === 'slide')
    .forEach((slide, i) => {
      const number = Number(slide.metadata?.slideNumber ?? i + 1);
      const children = slide.children ?? [];
      const titleNode = children.find((c) => c.type === 'heading');
      const title = textOf(titleNode);
      const body = children
        .filter((c) => c !== titleNode)
        .map((c) => (c.type === 'table' ? tableLines(c).join('\n') : textOf(c)))
        .filter(Boolean);
      const notes = (slide.notes ?? []).map(textOf).filter(Boolean);
      const parts = [title, ...body];
      if (notes.length > 0) parts.push(`Speaker notes: ${notes.join(' ')}`);
      const text = parts.filter(Boolean).join('\n');
      if (!text) return;
      sections.push({
        path: [title || `Slide ${number}`],
        text,
        locator: { kind: 'slide', slide: number },
        modality: 'text',
        kind: 'prose',
      });
    });
  return sections;
}

function mapParseError(input: LoaderInput, error: unknown): Error {
  const message = (error as Error)?.message ?? String(error);
  if (/limit|exceed|too many|too large|uncompressed/i.test(message)) {
    return new ArchiveLimitError(input.uri, message, { cause: error });
  }
  return new CorruptDocumentError(input.uri, message, { cause: error });
}

/**
 * Word, Excel and PowerPoint through officeparser's AST. docx: heading path, tables row by row,
 * footnotes kept. xlsx: one sheet at a time, rows like CSV with the header repeated, cached
 * formula values. pptx: one section per slide with title, body text and speaker notes.
 * Embedded images are not read (out of scope).
 */
export function createOfficeLoader(limits = OFFICE_LIMITS): DocumentLoader {
  return {
    name: 'office',
    extensions: ['.docx', '.xlsx', '.pptx'],
    async load(input, ctx): Promise<LoadedContent> {
      const format = input.extension.slice(1) as 'docx' | 'xlsx' | 'pptx';
      let ast: { type: string; metadata?: { title?: string }; content: OfficeNode[] };
      try {
        ast = (await parseOffice(Buffer.from(input.bytes), {
          // The extension is authoritative (magic bytes were checked by the registry).
          fileType: format,
          decompressionLimits: limits,
          ignoreNotes: false,
          extractAttachments: false,
          ocr: false,
        })) as unknown as typeof ast;
      } catch (error) {
        throw mapParseError(input, error);
      }
      const sections =
        format === 'docx'
          ? docxSections(ast.content)
          : format === 'xlsx'
            ? xlsxSections(ast.content, ctx)
            : pptxSections(ast.content);
      return {
        title: ast.metadata?.title?.trim() || baseTitle(input.fileName),
        format,
        sections,
      };
    },
  };
}

export const officeLoader = createOfficeLoader();
