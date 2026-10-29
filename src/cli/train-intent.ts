import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { RuleIntentClassifier } from '../adapters/baselines.js';
import { TransformersEmbedder } from '../adapters/embedder.js';
import {
  nextVersion,
  saveModel,
  setCurrentVersion,
  splitExamples,
  trainIntentModel,
} from '../adapters/tfjs.js';
import { loadConfig } from '../core/config.js';
import { PATHS } from '../core/paths.js';
import { INTENTS } from '../core/types.js';
import { runCli } from './args.js';

const SeedSchema = z.object({
  query: z.string().min(3),
  intent: z.enum(INTENTS as [string, ...string[]]),
});
const SEED = 7;

/**
 * npm run train:intent: embeds the hand-written seed queries, holds out 20% per class, trains the
 * 384 -> 32 -> 4 classifier and reports validation accuracy next to the rule baseline on the same
 * split. The model is the default only if validation accuracy reaches 0.80.
 */
runCli(async () => {
  const config = loadConfig();
  const seeds = readFileSync(config.domain.intentSeedFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => SeedSchema.parse(JSON.parse(l)));
  const embedder = new TransformersEmbedder();
  const examples = [];
  for (const s of seeds) {
    examples.push({
      query: s.query,
      intent: s.intent as (typeof INTENTS)[number],
      embedding: await embedder.embedQuery(s.query),
    });
  }
  await embedder.close();

  const { model, report } = await trainIntentModel(examples, { seed: SEED, epochs: 60 });
  const { val } = splitExamples(examples, SEED);
  const rules = new RuleIntentClassifier();
  let ruleHits = 0;
  for (const e of val) if ((await rules.classify(e.query)).intent === e.intent) ruleHits++;
  const ruleValAccuracy = val.length ? ruleHits / val.length : 0;

  const root = path.join(PATHS.models, 'intent');
  const version = nextVersion(root);
  const dir = path.join(root, `v${version}`);
  await saveModel(model, dir);
  const full = {
    ...report,
    ruleValAccuracy,
    seeds: seeds.length,
    perClass: Object.fromEntries(
      INTENTS.map((i) => [i, seeds.filter((s) => s.intent === i).length]),
    ),
    seed: SEED,
    embeddingModel: embedder.modelId,
    default: report.valAccuracy >= 0.8 ? 'model' : 'rules',
    trainedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(full, null, 2)}\n`);
  setCurrentVersion(root, version);
  process.stdout.write(
    [
      `Intent classifier v${version} saved to models/intent/v${version}`,
      `seeds=${seeds.length} ${JSON.stringify(full.perClass)} train=${report.trainSize} val=${report.valSize} epochs=${report.epochs}`,
      `train accuracy=${report.trainAccuracy.toFixed(3)} validation accuracy=${report.valAccuracy.toFixed(3)} (target 0.80)`,
      `rule baseline validation accuracy=${ruleValAccuracy.toFixed(3)}`,
      `default used by ask: ${full.default}`,
      '',
    ].join('\n'),
  );
  return 0;
});
