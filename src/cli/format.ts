import type { Candidate, ChainState } from '../core/chain.js';
import { formatLocator } from '../core/locator.js';
import type { GraphCounts } from '../core/store.js';

export const fmt = (n: number | undefined, digits = 4) =>
  n === undefined ? '-' : n.toFixed(digits);

export function candidateLine(c: Candidate, i: number): string {
  const ch = c.chunk;
  const scores = [
    `score=${fmt(c.score)}`,
    `cos=${fmt(c.cosine)}`,
    c.vectorRank !== undefined ? `vec#${c.vectorRank + 1}` : '',
    c.fulltextRank !== undefined ? `ft#${c.fulltextRank + 1}` : '',
    c.rerankScore !== undefined ? `rerank=${fmt(c.rerankScore)}` : '',
    c.expansion ? `graph:${c.expansion.kind}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${String(i + 1).padStart(2)}. ${ch.documentTitle} > ${ch.section} (${formatLocator(ch.locator, ch.documentFormat)}) [${scores}] id=${ch.id.slice(0, 12)}`;
}

export function graphPaths(state: ChainState): string[] {
  const byId = new Map([...state.fused, ...state.expanded].map((c) => [c.chunk.id, c]));
  return state.expanded.map((c) => {
    const from = byId.get(c.expansion!.fromChunkId);
    const fromLabel = from
      ? `${from.chunk.documentTitle} > ${from.chunk.section}`
      : c.expansion!.fromChunkId;
    const via = c.expansion!.via.length ? ` via ${c.expansion!.via.join(', ')}` : '';
    return `${fromLabel} -[${c.expansion!.kind}${via}]-> ${c.chunk.documentTitle} > ${c.chunk.section}`;
  });
}

/** Human-readable trace of every retrieval stage (used by ask --retrieval-only and the evidence). */
export function describeRetrieval(state: ChainState, limit = 10): string {
  const lines: string[] = [];
  lines.push(`Question: ${state.question}`);
  if (state.retrievalQuery !== state.question)
    lines.push(`Retrieval query: ${state.retrievalQuery}`);
  lines.push(
    `Mode: ${state.mode} | Intent: ${state.intent} (${state.intentSource}) | Collection: ${state.collection ?? 'all'}`,
  );
  lines.push(
    '',
    `Vector hits (top ${Math.min(limit, state.vectorHits.length)} of ${state.vectorHits.length}):`,
  );
  state.vectorHits
    .slice(0, limit)
    .forEach((h, i) =>
      lines.push(
        `${String(i + 1).padStart(2)}. ${h.chunk.documentTitle} > ${h.chunk.section} score=${fmt(h.score)}`,
      ),
    );
  if (state.fulltextHits.length > 0) {
    lines.push(
      '',
      `Fulltext hits (top ${Math.min(limit, state.fulltextHits.length)} of ${state.fulltextHits.length}):`,
    );
    state.fulltextHits
      .slice(0, limit)
      .forEach((h, i) =>
        lines.push(
          `${String(i + 1).padStart(2)}. ${h.chunk.documentTitle} > ${h.chunk.section} score=${fmt(h.score)}`,
        ),
      );
  }
  lines.push('', `Graph expansion (${state.expanded.length} chunks):`);
  const paths = graphPaths(state);
  lines.push(...(paths.length ? paths.slice(0, limit).map((p) => `  ${p}`) : ['  (none)']));
  lines.push('', `Ranked (top ${Math.min(limit, state.ranked.length)} of ${state.ranked.length}):`);
  lines.push(...state.ranked.slice(0, limit).map(candidateLine));
  lines.push(
    '',
    `Context (${state.context.length} chunks, ${state.context.reduce((n, c) => n + c.chunk.tokenCount, 0)} tokens):`,
  );
  lines.push(...state.context.map(candidateLine));
  if (state.gate?.applied) {
    lines.push(
      '',
      `Evidence gate: best=${fmt(state.gate.bestScore)} threshold=${fmt(state.gate.threshold)} -> ${state.gate.passed ? 'PASS' : 'REFUSE (no LLM call)'}`,
    );
  }
  lines.push('', `Timings (ms): ${JSON.stringify(state.timings)}`);
  return lines.join('\n');
}

export function countsLine(c: GraphCounts): string {
  return (
    `documents=${c.documents} chunks=${c.chunks} entities=${c.entities} HAS_CHUNK=${c.hasChunk} ` +
    `NEXT=${c.next} MENTIONS=${c.mentions} LINKS_TO=${c.linksTo} CO_OCCURS=${c.coOccurs} orphanEntities=${c.orphanEntities}`
  );
}

/** Chain state without embeddings, for JSON reports and data/last-ask.json. */
export function serializableState(state: ChainState): unknown {
  const strip = (c: Candidate) => ({ ...c, chunk: { ...c.chunk, embedding: undefined } });
  return {
    ...state,
    queryEmbedding: undefined,
    vectorHits: state.vectorHits.map((h) => ({
      score: h.score,
      chunkId: h.chunk.id,
      title: h.chunk.documentTitle,
      section: h.chunk.section,
    })),
    fulltextHits: state.fulltextHits.map((h) => ({
      score: h.score,
      chunkId: h.chunk.id,
      title: h.chunk.documentTitle,
      section: h.chunk.section,
    })),
    fused: state.fused.map(strip),
    expanded: state.expanded.map(strip),
    ranked: state.ranked.map(strip),
    context: state.context.map(strip),
  };
}
