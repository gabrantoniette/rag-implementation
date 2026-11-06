import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MODES, type Mode } from '../core/chain.js';
import { askEventFields } from '../core/events.js';
import { PATHS } from '../core/paths.js';
import { createRag } from '../index.js';
import { flagString, parseArgs, runCli } from './args.js';
import { describeRetrieval, serializableState } from './format.js';

/**
 * npm run ask -- [--mode vector|hybrid|graph|rerank|full] [--retrieval-only] [--collection name] "question"
 * Retrieval-only prints every stage and never calls the LLM. The last result is saved to
 * data/last-ask.json so `npm run feedback -- up|down` can rate it.
 */
runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ['retrieval-only', 'json']);
  const question = args.positionals.join(' ').trim();
  const mode = (flagString(args, 'mode') ?? 'full') as Mode;
  if (!question || !MODES.includes(mode)) {
    process.stderr.write(
      `Usage: npm run ask -- [--mode ${MODES.join('|')}] [--retrieval-only] "question"\n`,
    );
    return 1;
  }
  const retrievalOnly = args.flags['retrieval-only'] === true;
  const rag = await createRag(retrievalOnly ? { llm: 'none' } : {});
  try {
    const collection = flagString(args, 'collection');
    const result = await rag.ask(question, {
      mode,
      retrievalOnly,
      ...(collection ? { collection } : {}),
    });
    process.stdout.write(`${describeRetrieval(result.state)}\n`);
    if (!retrievalOnly) {
      process.stdout.write(`\n${'='.repeat(72)}\n${result.answer}\n${'='.repeat(72)}\n`);
      process.stdout.write(`model=${result.state.model ?? '-'} refused=${result.refused}\n`);
    }
    rag.logger.info('ask completed', askEventFields(result, { source: 'cli' }));
    mkdirSync(path.dirname(PATHS.lastAsk), { recursive: true });
    writeFileSync(PATHS.lastAsk, JSON.stringify(serializableState(result.state), null, 2));
    return 0;
  } finally {
    await rag.close();
  }
});
