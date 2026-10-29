/** Where a piece of text came from inside its document; stored on every chunk and shown in citations. */
export type Locator =
  | { kind: 'heading'; path: string[] }
  | { kind: 'paragraphs'; start: number; end: number }
  | { kind: 'rows'; start: number; end: number; sheet?: string }
  | { kind: 'records'; start: number; end: number }
  | { kind: 'keys'; first: string; last: string }
  | { kind: 'page'; page: number; ocr?: boolean }
  | { kind: 'time'; startSec: number; endSec: number; visual?: boolean }
  | { kind: 'slide'; slide: number }
  | { kind: 'image' };

export type Modality = 'text' | 'audio' | 'visual' | 'ocr';

/**
 * prose: the chunker splits it by paragraphs and sentences.
 * table / transcript: the loader already grouped rows or cues to the target size; the chunker keeps
 * each section whole and only enforces the token limit.
 */
export type SectionKind = 'prose' | 'table' | 'transcript';

export interface WikiLink {
  /** Visible anchor text in the article. */
  anchor: string;
  /** Canonical target article title. */
  target: string;
}

export interface Section {
  path: string[];
  text: string;
  locator: Locator;
  modality: Modality;
  kind: SectionKind;
  /** Hyperlinks inside this section (Wikipedia only); used by WikiLinkExtractor. */
  links?: WikiLink[];
}

export type MetadataValue = string | number | boolean;

export interface ParsedDocument {
  id: string;
  title: string;
  uri: string;
  /** Loader format id, for example 'markdown', 'pdf', 'xlsx', 'wikipedia-html'. */
  format: string;
  contentHash: string;
  sections: Section[];
  metadata: Record<string, MetadataValue>;
  /** Outgoing links to other documents (Wikipedia article titles). */
  links: string[];
}

export type Intent = 'lookup' | 'explain' | 'compare' | 'timeline';
export const INTENTS: readonly Intent[] = ['lookup', 'explain', 'compare', 'timeline'];

/** A chunk as produced by the chunker, before embedding. */
export interface ChunkDraft {
  chunkIndex: number;
  /** "Title > Section"; part of the stored and embedded text. */
  header: string;
  /** Section label used in citations (heading path or a format default). */
  section: string;
  /** header + "\n" + body; the stored and embedded text. */
  text: string;
  tokenCount: number;
  locator: Locator;
  modality: Modality;
  sectionIndex: number;
  /** sha256 of header plus text: the identity used by incremental updates. */
  contentHash: string;
  warnings: string[];
}

/** A chunk as stored, with the fields every store returns. */
export interface StoredChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  section: string;
  locator: Locator;
  modality: Modality;
  tokenCount: number;
  contentHash: string;
  embedding?: number[];
  entities?: string[];
}

export interface DocumentRecord {
  id: string;
  collection: string;
  title: string;
  uri: string;
  format: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  license?: string;
  revid?: number;
  metadata: Record<string, MetadataValue>;
}
