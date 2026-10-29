import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import { CorpusSchema, topicOf } from '../loaders/wikipedia-fetch.js';
import { WIKIPEDIA_EXTENSION } from '../loaders/wikipedia.js';
import { createRag } from '../index.js';
import { runCli } from './args.js';
import { countsLine } from './format.js';

/** title -> cached article HTML, from the data/raw/*.meta.json records. */
function rawArticles(): Map<string, string> {
  const map = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(PATHS.raw).filter((f) => f.endsWith('.meta.json'));
  } catch {
    return map;
  }
  for (const f of files) {
    const meta = JSON.parse(readFileSync(path.join(PATHS.raw, f), 'utf8')) as { title: string };
    map.set(meta.title, path.join(PATHS.raw, f.replace(/\.meta\.json$/, WIKIPEDIA_EXTENSION)));
  }
  return map;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

/**
 * npm run ingest:build: upserts every corpus article (idempotent), embedding only new chunks,
 * then prints the graph counts before and after and the entity degree distribution.
 */
runCli(async () => {
  const rag = await createRag({ llm: 'none' });
  try {
    const corpus = CorpusSchema.parse(
      JSON.parse(readFileSync(rag.config.domain.corpusFile, 'utf8')),
    );
    const raw = rawArticles();
    const before = await rag.store.counts();
    process.stdout.write(`counts before: ${countsLine(before)}\n`);
    const embeddedBefore = rag.documents.embeddedChunks;
    const tally = { created: 0, reindexed: 0, unchanged: 0, metadata: 0, missing: 0 };
    const start = performance.now();
    for (const [i, entry] of corpus.entries()) {
      const file = raw.get(entry.title);
      if (!file) {
        process.stdout.write(`missing raw article: ${entry.title} (run npm run ingest:fetch)\n`);
        tally.missing++;
        continue;
      }
      const { created, result } = await rag.documents.upsert({
        source: { path: file },
        collection: rag.config.domain.collection,
        metadata: { topic: topicOf(entry) },
      });
      if (created) tally.created++;
      else tally[result.status]++;
      process.stdout.write(
        `[${i + 1}/${corpus.length}] ${entry.title}: ${created ? 'created' : result.status} (+${result.added} -${result.removed} =${result.kept})\n`,
      );
    }
    const after = await rag.store.counts();
    const degrees = (await rag.store.entityDegrees()).sort((a, b) => a - b);
    process.stdout.write(
      [
        '',
        `counts after:  ${countsLine(after)}`,
        `documents: created ${tally.created}, reindexed ${tally.reindexed}, metadata ${tally.metadata}, unchanged ${tally.unchanged}, missing ${tally.missing}`,
        `chunks embedded this run: ${rag.documents.embeddedChunks - embeddedBefore}`,
        `entity degree (chunks per entity): p50=${percentile(degrees, 50)} p90=${percentile(degrees, 90)} p99=${percentile(degrees, 99)} max=${degrees[degrees.length - 1] ?? 0}; entities above hub threshold ${rag.config.parameters.retrieval.hubDegreeThreshold}: ${degrees.filter((d) => d > rag.config.parameters.retrieval.hubDegreeThreshold).length}`,
        `elapsed: ${((performance.now() - start) / 1000).toFixed(1)} s`,
        '',
      ].join('\n'),
    );
    return tally.missing > 0 ? 1 : 0;
  } finally {
    await rag.close();
  }
});
