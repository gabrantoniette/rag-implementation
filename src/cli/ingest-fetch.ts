import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, secretValues } from '../core/config.js';
import { FetchBlockedError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { approximateTokenCounter } from '../core/tokens.js';
import { createRegistry } from '../loaders/index.js';
import { wordCount } from '../loaders/wikipedia.js';
import {
  CorpusSchema,
  fetchArticle,
  rawPaths,
  saveArticle,
  wikimediaUserAgent,
} from '../loaders/wikipedia-fetch.js';
import { parseArgs, runCli } from './args.js';

const MIN_WORDS = 1500;
const MIN_INTERVAL_MS = 1100; // at most one request per second

/**
 * npm run ingest:fetch [-- --refresh]
 * Downloads every article in <domain>/corpus.json into data/raw (sequential, >= 1 s apart,
 * descriptive User-Agent), then verifies each one returned HTTP 200 and has >= 1500 words.
 */
runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ['refresh']);
  const config = loadConfig();
  const logger = createLogger({ level: config.env.LOG_LEVEL, secrets: secretValues(config.env) });
  const corpus = CorpusSchema.parse(JSON.parse(readFileSync(config.domain.corpusFile, 'utf8')));
  const userAgent = wikimediaUserAgent(config.env.WIKIMEDIA_CONTACT);

  let fetched = 0;
  let skipped = 0;
  let lastRequest = 0;
  const saved = new Map<string, string>();
  for (const entry of corpus) {
    const guess = rawPaths(PATHS.raw, entry.title.replace(/ /g, '_'));
    if (!args.flags.refresh && existsSync(guess.html) && existsSync(guess.meta)) {
      saved.set(entry.title, guess.html);
      skipped++;
      continue;
    }
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const { html, meta } = await fetchArticle(entry.title, userAgent);
      saved.set(entry.title, saveArticle(PATHS.raw, html, meta));
      fetched++;
      logger.info(`fetched ${entry.title} (revid ${meta.revid})`);
    } catch (error) {
      if (error instanceof FetchBlockedError) {
        logger.error(error.message);
        return 2;
      }
      logger.error(`failed: ${entry.title}`, error);
    }
  }

  // Verification: HTTP 200 (file saved) and at least MIN_WORDS words of article prose.
  const registry = createRegistry(config.env.MAX_FILE_MB * 1024 * 1024);
  const ctx = { tokens: approximateTokenCounter, parameters: config.parameters, logger };
  const rows: string[] = [];
  let failures = 0;
  let totalWords = 0;
  for (const entry of corpus) {
    const file = saved.get(entry.title);
    if (!file) {
      rows.push(`| ${entry.title} | ${entry.sport} | - | - | MISSING |`);
      failures++;
      continue;
    }
    const doc = await registry.loadFile(file, ctx);
    const words = wordCount(doc.sections);
    totalWords += words;
    const ok = words >= MIN_WORDS;
    if (!ok) failures++;
    rows.push(
      `| ${entry.title} | ${entry.sport} | ${doc.metadata.revid ?? '-'} | ${words} | ${ok ? 'OK' : `< ${MIN_WORDS} words`} |`,
    );
  }
  process.stdout.write(
    [
      `Fetched ${fetched}, already present ${skipped}, articles ${corpus.length}`,
      '',
      '| Title | Sport | revid | Words | Check |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
      `Total words: ${totalWords}. Failures: ${failures}.`,
      '',
    ].join('\n'),
  );
  return failures > 0 ? 1 : 0;
});
