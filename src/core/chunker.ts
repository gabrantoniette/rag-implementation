import { sha256 } from './hash.js';
import { sectionLabel } from './locator.js';
import { type TokenCounter, tailTokens, truncateToTokens } from './tokens.js';
import type { ChunkDraft, Locator, Modality, ParsedDocument, SectionKind } from './types.js';

export interface ChunkingOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
  minTokens: number;
}

interface Unit {
  text: string;
  tokens: number;
  /** True when this unit starts a new paragraph (joined with a blank line). */
  newParagraph: boolean;
}

interface RawChunk {
  sectionIndex: number;
  header: string;
  section: string;
  /** Text carried over from the previous chunk of the same section. */
  overlap: string;
  /** New text of this chunk. */
  body: string;
  newTokens: number;
  locator: Locator;
  modality: Modality;
  kind: SectionKind;
  warnings: string[];
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function sentences(paragraph: string): string[] {
  return [...segmenter.segment(paragraph)].map((s) => s.segment.trim()).filter(Boolean);
}

/** Splits text into word windows of at most `limit` tokens. */
function wordWindows(text: string, limit: number, counter: TokenCounter): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > 0) {
    const piece = truncateToTokens(rest, limit, counter);
    // A single "word" longer than the limit (rare): cut by characters to guarantee progress.
    const take = piece.length > 0 ? piece : rest.slice(0, Math.max(1, limit * 2));
    out.push(take);
    rest = rest.slice(take.length).trim();
  }
  return out;
}

/** Paragraphs split on blank lines; fenced code blocks (``` or ~~~) are kept as one paragraph. */
export function paragraphs(text: string): { text: string; fenced: boolean }[] {
  const out: { text: string; fenced: boolean }[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = (fenced: boolean) => {
    const t = buf.join('\n').trim();
    if (t) out.push({ text: t, fenced });
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const marker = line.trimStart().match(/^(```|~~~)/)?.[1];
    if (fence) {
      buf.push(line);
      if (marker === fence) {
        flush(true);
        fence = null;
      }
      continue;
    }
    if (marker) {
      flush(false);
      fence = marker;
      buf.push(line);
      continue;
    }
    if (line.trim() === '') flush(false);
    else buf.push(line);
  }
  flush(fence !== null);
  return out;
}

function proseUnits(text: string, opts: ChunkingOptions, counter: TokenCounter): Unit[] {
  const units: Unit[] = [];
  // Units leave room for the overlap so overlap + unit stays within the target.
  const limit = Math.max(1, opts.targetTokens - opts.overlapTokens);
  for (const para of paragraphs(text)) {
    const tokens = counter.count(para.text);
    if (para.fenced) {
      if (tokens <= opts.maxTokens) {
        units.push({ text: para.text, tokens, newParagraph: true });
      } else {
        // Code block over the limit: split by lines, then by words for very long lines.
        let first = true;
        let group: string[] = [];
        let groupTokens = 0;
        const push = () => {
          if (group.length === 0) return;
          units.push({ text: group.join('\n'), tokens: groupTokens, newParagraph: first });
          first = false;
          group = [];
          groupTokens = 0;
        };
        for (const line of para.text.split('\n')) {
          const t = counter.count(line);
          if (t > limit) {
            push();
            for (const w of wordWindows(line, limit, counter)) {
              units.push({ text: w, tokens: counter.count(w), newParagraph: first });
              first = false;
            }
            continue;
          }
          if (groupTokens + t > limit) push();
          group.push(line);
          groupTokens += t;
        }
        push();
      }
      continue;
    }
    if (tokens <= limit) {
      units.push({ text: para.text, tokens, newParagraph: true });
      continue;
    }
    let first = true;
    for (const sentence of sentences(para.text)) {
      const t = counter.count(sentence);
      const pieces = t > limit ? wordWindows(sentence, limit, counter) : [sentence];
      for (const piece of pieces) {
        units.push({
          text: piece,
          tokens: piece === sentence ? t : counter.count(piece),
          newParagraph: first,
        });
        first = false;
      }
    }
  }
  return units;
}

function joinUnits(units: Unit[]): string {
  return units
    .map((u, i) => (i === 0 ? u.text : `${u.newParagraph ? '\n\n' : ' '}${u.text}`))
    .join('');
}

/** Greedy packing of prose units into windows of about targetTokens with overlapTokens of overlap. */
function packProse(
  text: string,
  opts: ChunkingOptions,
  counter: TokenCounter,
): { overlap: string; body: string; newTokens: number }[] {
  const units = proseUnits(text, opts, counter);
  const out: { overlap: string; body: string; newTokens: number }[] = [];
  let overlap = '';
  let overlapTokens = 0;
  let current: Unit[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    const body = joinUnits(current);
    out.push({ overlap, body, newTokens: currentTokens });
    overlap = tailTokens(body, opts.overlapTokens, counter);
    overlapTokens = overlap ? counter.count(overlap) : 0;
    current = [];
    currentTokens = 0;
  };
  for (const unit of units) {
    if (current.length > 0 && overlapTokens + currentTokens + unit.tokens > opts.targetTokens) {
      flush();
    }
    // A large unit (an intact code block) starts without overlap so the chunk stays within maxTokens.
    if (current.length === 0 && overlapTokens + unit.tokens > opts.maxTokens) {
      overlap = '';
      overlapTokens = 0;
    }
    current.push(unit);
    currentTokens += unit.tokens;
  }
  flush();
  return out;
}

const fullBody = (c: RawChunk) => (c.overlap ? `${c.overlap} ${c.body}` : c.body);

/**
 * Turns a parsed document into chunks. Every chunk's stored and embedded text starts with a
 * 'Title > Section' header. Prose is split by paragraphs and sentences into ~targetTokens windows
 * with overlapTokens of overlap; table and transcript sections were grouped by their loader and
 * are only held to maxTokens. A prose chunk below minTokens merges with a neighbour.
 */
export function chunkDocument(
  doc: ParsedDocument,
  counter: TokenCounter,
  opts: ChunkingOptions,
): ChunkDraft[] {
  const raw: RawChunk[] = [];
  doc.sections.forEach((section, sectionIndex) => {
    const text = section.text.trim();
    if (!text) return;
    const label = sectionLabel(section, doc.format);
    const base = {
      sectionIndex,
      header: `${doc.title} > ${label}`,
      section: label,
      locator: section.locator,
      modality: section.modality,
      kind: section.kind,
    };
    if (section.kind === 'prose') {
      for (const piece of packProse(text, opts, counter)) {
        raw.push({ ...base, ...piece, warnings: [] });
      }
      return;
    }
    const tokens = counter.count(text);
    if (tokens <= opts.maxTokens) {
      raw.push({ ...base, overlap: '', body: text, newTokens: tokens, warnings: [] });
    } else if (section.kind === 'table') {
      const body = truncateToTokens(text, opts.maxTokens, counter);
      raw.push({
        ...base,
        overlap: '',
        body,
        newTokens: counter.count(body),
        warnings: [`table row truncated from ${tokens} to ${opts.maxTokens} tokens`],
      });
    } else {
      for (const piece of wordWindows(text, opts.targetTokens, counter)) {
        raw.push({
          ...base,
          overlap: '',
          body: piece,
          newTokens: counter.count(piece),
          warnings: [],
        });
      }
    }
  });

  // Merge prose chunks below minTokens into a neighbour when the result stays within maxTokens.
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c.kind !== 'prose' || c.newTokens >= opts.minTokens || raw.length === 1) continue;
    const prev = raw[i - 1];
    const next = raw[i + 1];
    const label = (from: RawChunk, into: RawChunk) =>
      from.sectionIndex === into.sectionIndex ? '' : `${from.section}: `;
    if (prev?.kind === 'prose' && counter.count(fullBody(prev)) + c.newTokens <= opts.maxTokens) {
      prev.body = `${prev.body}\n\n${label(c, prev)}${c.body}`;
      prev.newTokens += c.newTokens;
      prev.warnings.push(...c.warnings);
      raw.splice(i, 1);
      i--;
    } else if (
      next?.kind === 'prose' &&
      counter.count(fullBody(next)) + c.newTokens <= opts.maxTokens
    ) {
      // The next chunk's overlap is a tail of c itself, so it is replaced by c's full text.
      next.body = `${label(c, next)}${fullBody(c)}\n\n${next.body}`;
      next.overlap = '';
      next.newTokens += c.newTokens;
      next.warnings.push(...c.warnings);
      raw.splice(i, 1);
      i--;
    }
  }

  return raw.map((c, chunkIndex) => {
    const text = `${c.header}\n${fullBody(c)}`;
    return {
      chunkIndex,
      header: c.header,
      section: c.section,
      text,
      tokenCount: counter.count(text),
      locator: c.locator,
      modality: c.modality,
      sectionIndex: c.sectionIndex,
      contentHash: sha256(text),
      warnings: c.warnings,
    };
  });
}
