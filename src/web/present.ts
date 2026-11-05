import type { Candidate, ChainState, Mode } from '../core/chain.js';
import type { Parameters } from '../core/config.js';
import { answerSentences, chunkBody, isRefusal, markdownSection } from '../core/generation.js';
import { formatLocator } from '../core/locator.js';
import type { AskResult } from '../core/rag.js';

/**
 * View models for the chat page. Everything the page shows is derived here from the chain state,
 * so the browser never re-implements verification or citation logic.
 */

export type AnswerStatus = 'answered' | 'refused' | 'held' | 'retrieval';

export interface SentenceView {
  part: 'answer' | 'point';
  /** Sentence text without its [n] markers. */
  text: string;
  citations: number[];
  /** Best cosine similarity with a cited chunk; null when the mode does not verify. */
  support: number | null;
  supported: boolean | null;
}

export interface SourceView {
  n: number;
  chunkId: string;
  title: string;
  section: string;
  locator: string;
  uri: string;
  text: string;
  cited: boolean;
  score: number;
  cosine: number;
  rerankScore: number | null;
  vectorRank: number | null;
  fulltextRank: number | null;
  /** How graph expansion reached this chunk, when it did. */
  via: { kind: string; from: string; through: string[] } | null;
}

export interface RankedView {
  rank: number;
  chunkId: string;
  title: string;
  section: string;
  score: number;
  cosine: number;
  rrf: number;
  rerankScore: number | null;
  vectorRank: number | null;
  fulltextRank: number | null;
  expansion: string | null;
  /** Position in the context sent to the model (the [n] number), or null. */
  contextN: number | null;
}

export interface HitView {
  rank: number;
  chunkId: string;
  title: string;
  section: string;
  score: number;
}

export interface GraphPathView {
  kind: string;
  from: string;
  to: string;
  through: string[];
  throughTotal: number;
  chunkId: string;
}

export interface TraceView {
  intent: string | null;
  intentSource: string | null;
  retrievalQuery: string | null;
  vector: HitView[];
  vectorTotal: number;
  fulltext: HitView[];
  fulltextTotal: number;
  fusedTotal: number;
  graph: GraphPathView[];
  graphTotal: number;
  ranked: RankedView[];
  rankedTotal: number;
  contextTokens: number;
  gate: { applied: boolean; passed: boolean; bestScore: number; threshold: number } | null;
  verification: {
    groundingScore: number;
    passed: boolean;
    citationsValid: boolean;
    invalidCitations: number[];
    structureErrors: string[];
  } | null;
  timings: Record<string, number>;
  totalMs: number;
  model: string | null;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  warnings: string[];
}

export interface AnswerView {
  id: string;
  question: string;
  mode: Mode;
  collection: string | null;
  status: AnswerStatus;
  /** The refusal sentence when status is refused or held. */
  refusal: string | null;
  sentences: SentenceView[];
  /** Key points written alongside a refusal; never verified, shown as the model's notes. */
  notes: SentenceView[];
  /** Exact share of supported sentences (full mode only), never rounded here. */
  confidence: number | null;
  supportedCount: number;
  checkedCount: number;
  thresholds: { support: number; pass: number; gate: number };
  sources: SourceView[];
  trace: TraceView;
  turn: AskResult['turn'];
}

export interface CompareView {
  question: string;
  modes: {
    mode: Mode;
    context: { chunkId: string; title: string; section: string; score: number }[];
    gate: { applied: boolean; passed: boolean; bestScore: number; threshold: number } | null;
    totalMs: number;
  }[];
}

const label = (c: Candidate) => `${c.chunk.documentTitle} › ${c.chunk.section}`;
const stripMarks = (s: string) =>
  s
    .replace(/\s*\[\d+\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
const unique = (ns: number[]) => [...new Set(ns)];
const citationsOf = (s: string) => unique([...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
const rank = (r: number | undefined) => (r === undefined ? null : r + 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Sentences of a raw '## Answer / ## Key points' reply, split into the two parts. */
export function splitParts(raw: string): { answer: string[]; points: string[] } {
  const all = answerSentences(raw);
  const answerOnly = answerSentences(`## Answer\n${markdownSection(raw, 'Answer') ?? ''}`);
  return { answer: all.slice(0, answerOnly.length), points: all.slice(answerOnly.length) };
}

function unverified(part: SentenceView['part'], sentence: string): SentenceView {
  return {
    part,
    text: stripMarks(sentence),
    citations: citationsOf(sentence),
    support: null,
    supported: null,
  };
}

function sentenceViews(state: ChainState, refusal: string): SentenceView[] {
  const raw = state.rawAnswer ?? '';
  const { answer, points } = splitParts(raw);
  const checks = state.verification?.sentences ?? [];
  if (checks.length > 0 && checks.length === answer.length + points.length) {
    return checks.map((c, i) => ({
      part: i < answer.length ? 'answer' : 'point',
      text: stripMarks(c.sentence),
      citations: unique(c.citations),
      support: c.support,
      supported: c.supported,
    }));
  }
  const views = [
    ...answer.map((s) => unverified('answer', s)),
    ...points.map((s) => unverified('point', s)),
  ];
  if (views.length === 0 && raw && !isRefusal(raw, refusal)) {
    // The model ignored the required structure: show its text as one unverified block.
    return [unverified('answer', raw.replace(/^##\s+.*$/gm, '').trim())];
  }
  return views;
}

function sourceViews(state: ChainState): SourceView[] {
  const cited = new Set(state.citations.map((c) => c.chunkId));
  const byId = new Map([...state.fused, ...state.expanded].map((c) => [c.chunk.id, c]));
  return state.context.map((c, i) => {
    const from = c.expansion ? byId.get(c.expansion.fromChunkId) : undefined;
    return {
      n: i + 1,
      chunkId: c.chunk.id,
      title: c.chunk.documentTitle,
      section: c.chunk.section,
      locator: formatLocator(c.chunk.locator, c.chunk.documentFormat),
      uri: c.chunk.documentUri,
      text: chunkBody(c.chunk.text),
      cited: cited.has(c.chunk.id),
      score: c.score,
      cosine: c.cosine,
      rerankScore: c.rerankScore ?? null,
      vectorRank: rank(c.vectorRank),
      fulltextRank: rank(c.fulltextRank),
      via: c.expansion
        ? {
            kind: c.expansion.kind,
            from: from ? label(from) : c.expansion.fromChunkId,
            through: c.expansion.via.slice(0, 8),
          }
        : null,
    };
  });
}

export function traceView(state: ChainState, limit = 12): TraceView {
  const contextN = new Map(state.context.map((c, i) => [c.chunk.id, i + 1]));
  const byId = new Map([...state.fused, ...state.expanded].map((c) => [c.chunk.id, c]));
  const hits = (list: ChainState['vectorHits']) =>
    list.slice(0, 10).map((h, i) => ({
      rank: i + 1,
      chunkId: h.chunk.id,
      title: h.chunk.documentTitle,
      section: h.chunk.section,
      score: h.score,
    }));
  return {
    intent: state.intent ?? null,
    intentSource: state.intentSource ?? null,
    retrievalQuery: state.retrievalQuery !== state.question ? state.retrievalQuery : null,
    vector: hits(state.vectorHits),
    vectorTotal: state.vectorHits.length,
    fulltext: hits(state.fulltextHits),
    fulltextTotal: state.fulltextHits.length,
    fusedTotal: state.fused.length,
    graph: state.expanded.slice(0, limit).map((c) => {
      const from = byId.get(c.expansion!.fromChunkId);
      return {
        kind: c.expansion!.kind,
        from: from ? label(from) : c.expansion!.fromChunkId,
        to: label(c),
        through: c.expansion!.via.slice(0, 6),
        throughTotal: c.expansion!.via.length,
        chunkId: c.chunk.id,
      };
    }),
    graphTotal: state.expanded.length,
    ranked: state.ranked.slice(0, limit).map((c, i) => ({
      rank: i + 1,
      chunkId: c.chunk.id,
      title: c.chunk.documentTitle,
      section: c.chunk.section,
      score: c.score,
      cosine: c.cosine,
      rrf: c.rrf,
      rerankScore: c.rerankScore ?? null,
      vectorRank: rank(c.vectorRank),
      fulltextRank: rank(c.fulltextRank),
      expansion: c.expansion?.kind ?? null,
      contextN: contextN.get(c.chunk.id) ?? null,
    })),
    rankedTotal: state.ranked.length,
    contextTokens: sum(state.context.map((c) => c.chunk.tokenCount)),
    gate: state.gate ?? null,
    verification: state.verification
      ? {
          groundingScore: state.verification.groundingScore,
          passed: state.verification.passed,
          citationsValid: state.verification.citationsValid,
          invalidCitations: state.verification.invalidCitations,
          structureErrors: state.verification.structureErrors,
        }
      : null,
    timings: state.timings,
    totalMs: sum(Object.values(state.timings)),
    model: state.model ?? null,
    usage: state.usage ?? null,
    warnings: state.warnings,
  };
}

export function answerView(
  id: string,
  result: AskResult,
  options: { retrievalOnly: boolean; refusal: string; parameters: Parameters },
): AnswerView {
  const { state } = result;
  const held = state.gate?.applied === true && !state.gate.passed;
  const raw = state.rawAnswer ?? '';
  const refused = !held && raw !== '' && isRefusal(raw, options.refusal);
  const status: AnswerStatus = options.retrievalOnly
    ? 'retrieval'
    : held
      ? 'held'
      : refused
        ? 'refused'
        : 'answered';
  const all =
    status === 'answered' || status === 'refused' ? sentenceViews(state, options.refusal) : [];
  const sentences = status === 'answered' ? all : [];
  const notes = status === 'refused' ? all.filter((s) => s.part === 'point') : [];
  const checked = sentences.filter((s) => s.supported !== null);
  return {
    id,
    question: state.question,
    mode: state.mode,
    collection: state.collection ?? null,
    status,
    refusal: held || refused ? options.refusal : null,
    sentences,
    notes,
    confidence: status === 'answered' ? result.confidence : null,
    supportedCount: checked.filter((s) => s.supported).length,
    checkedCount: checked.length,
    thresholds: {
      support: options.parameters.verification.sentenceSupportThreshold,
      pass: options.parameters.verification.groundingPassThreshold,
      gate: options.parameters.evidenceGate.threshold,
    },
    sources: sourceViews(state),
    trace: traceView(state),
    turn: result.turn,
  };
}

export function compareEntry(state: ChainState): CompareView['modes'][number] {
  return {
    mode: state.mode,
    context: state.context.map((c) => ({
      chunkId: c.chunk.id,
      title: c.chunk.documentTitle,
      section: c.chunk.section,
      score: c.score,
    })),
    gate: state.gate ?? null,
    totalMs: sum(Object.values(state.timings)),
  };
}
