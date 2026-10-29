import type { Locator, Section } from './types.js';

const FORMAT_LABELS: Record<string, string> = {
  'wikipedia-html': 'Wikipedia',
  markdown: 'Markdown',
  html: 'HTML',
  docx: 'Word',
  text: 'text',
};

/** Seconds to hh:mm:ss. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const range = (a: number, b: number) => (a === b ? `${a}` : `${a}-${b}`);

/**
 * Human-readable locator used in citations, for example 'page 3', 'page 3 (OCR)', 'rows 120-168',
 * "Sheet 'Sales' rows 2-40", '00:12:03-00:12:41', 'slide 4', 'image'. A heading locator repeats the
 * section already shown before it, so it renders as the source type instead ('Wikipedia section').
 */
export function formatLocator(locator: Locator, format = ''): string {
  switch (locator.kind) {
    case 'heading':
      return `${FORMAT_LABELS[format] ?? format} section`.trim();
    case 'paragraphs':
      return locator.start === locator.end
        ? `paragraph ${locator.start}`
        : `paragraphs ${locator.start}-${locator.end}`;
    case 'rows':
      return locator.sheet !== undefined
        ? `Sheet '${locator.sheet}' rows ${range(locator.start, locator.end)}`
        : `rows ${range(locator.start, locator.end)}`;
    case 'records':
      return `records ${range(locator.start, locator.end)}`;
    case 'keys':
      return locator.first === locator.last
        ? `key ${locator.first}`
        : `keys ${locator.first} to ${locator.last}`;
    case 'page':
      return locator.ocr ? `page ${locator.page} (OCR)` : `page ${locator.page}`;
    case 'time': {
      const t = `${formatTimestamp(locator.startSec)}-${formatTimestamp(locator.endSec)}`;
      return locator.visual ? `${t} on-screen` : t;
    }
    case 'slide':
      return `slide ${locator.slide}`;
    case 'image':
      return 'image';
  }
}

const DEFAULT_SECTION_LABELS: Record<string, string> = {
  pdf: 'Text',
  text: 'Text',
  csv: 'Table',
  tsv: 'Table',
  xlsx: 'Table',
  json: 'Records',
  jsonl: 'Records',
  srt: 'Transcript',
  vtt: 'Transcript',
  audio: 'Transcript',
  video: 'Transcript',
};

/** Section label for "Title > Section": the heading path, or a format default when there is none. */
export function sectionLabel(section: Pick<Section, 'path'>, format: string): string {
  if (section.path.length > 0) return section.path.join(' > ');
  if (['wikipedia-html', 'markdown', 'html', 'docx'].includes(format)) return 'Introduction';
  return DEFAULT_SECTION_LABELS[format] ?? 'Text';
}
