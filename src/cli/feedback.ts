import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../core/config.js';
import { appendFeedback } from '../core/feedback.js';
import { PATHS } from '../core/paths.js';
import { createAppLogger } from '../logging.js';
import { parseArgs, runCli } from './args.js';

/**
 * npm run feedback -- up|down
 * Rates the last `npm run ask` answer: appends {question, chunkIds, cited, rating} to
 * data/feedback.jsonl, which `npm run train:reranker` learns from.
 */
runCli(async () => {
  const { positionals } = parseArgs(process.argv.slice(2));
  const rating = positionals[0];
  if (rating !== 'up' && rating !== 'down') {
    process.stderr.write(
      'Usage: npm run feedback -- up|down   (rates the last npm run ask answer)\n',
    );
    return 1;
  }
  if (!existsSync(PATHS.lastAsk)) {
    process.stderr.write('No previous answer found (data/last-ask.json). Run npm run ask first.\n');
    return 1;
  }
  const last = JSON.parse(readFileSync(PATHS.lastAsk, 'utf8')) as {
    question: string;
    context: { chunk: { id: string } }[];
    citations: { chunkId: string }[];
  };
  appendFeedback(PATHS.feedback, {
    question: last.question,
    chunkIds: last.context.map((c) => c.chunk.id),
    cited: last.citations.map((c) => c.chunkId),
    rating,
    at: new Date().toISOString(),
  });
  const logger = createAppLogger(loadConfig(), 'rag-cli');
  logger.info('feedback saved', {
    event: 'feedback.saved',
    rating,
    question: last.question,
    cited: last.citations.length,
  });
  await logger.close?.();
  process.stdout.write(
    `Recorded '${rating}' for: ${last.question} (${last.citations.length} cited chunks)\n`,
  );
  return 0;
});
