import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PassThroughReranker, RuleIntentClassifier } from './adapters/baselines.js';
import { TransformersEmbedder } from './adapters/embedder.js';
import { NerExtractor, WikiLinkExtractor } from './adapters/entities.js';
import { InMemoryStore } from './adapters/memory-store.js';
import { MockLlmClient } from './adapters/mock-llm.js';
import { Neo4jStore } from './adapters/neo4j-store.js';
import { OpenRouterClient } from './adapters/openrouter.js';
import { QuotaGuard } from './adapters/quota.js';
import { TfjsIntentClassifier, TfjsReranker, currentVersion } from './adapters/tfjs.js';
import { createModelTokenCounter } from './adapters/tokenizer.js';
import { WhisperRecognizer } from './adapters/whisper.js';
import { type AppConfig, loadConfig, secretValues } from './core/config.js';
import { ConfigError } from './core/errors.js';
import { normalizeUri } from './core/hash.js';
import { type Logger, createLogger } from './core/logger.js';
import { PATHS } from './core/paths.js';
import type {
  Embedder,
  EntityExtractor,
  IntentClassifier,
  LlmClient,
  Reranker,
} from './core/ports.js';
import { loadPromptFiles } from './core/prompt.js';
import { type Rag, buildRag } from './core/rag.js';
import type { VectorGraphStore } from './core/store.js';
import type { TokenCounter } from './core/tokens.js';
import { createRegistry } from './loaders/index.js';
import type { LoaderContext } from './loaders/types.js';
import { fetchArticle, saveArticle, wikimediaUserAgent } from './loaders/wikipedia-fetch.js';
import { LazyCaptioner } from './vision/captioner.js';
import { FfmpegTools, findFfmpeg } from './vision/ffmpeg.js';
import { TesseractOcr } from './vision/ocr.js';

const custom = <T>() => z.custom<T>((v) => typeof v === 'object' && v !== null);

export const CreateRagConfigSchema = z.object({
  /** Explicit environment (otherwise process.env plus .env). */
  env: z.record(z.string(), z.string().optional()).optional(),
  domainDir: z.string().optional(),
  store: z.union([z.enum(['neo4j', 'memory']), custom<VectorGraphStore>()]).default('neo4j'),
  embedder: custom<Embedder>().optional(),
  tokens: custom<TokenCounter>().optional(),
  /** openrouter (default when a key is set), none (retrieval only), mock, or a client. */
  llm: z.union([z.enum(['openrouter', 'none', 'mock']), custom<LlmClient>()]).optional(),
  reranker: z.union([z.enum(['auto', 'pass-through']), custom<Reranker>()]).default('auto'),
  intent: z.union([z.enum(['auto', 'rules']), custom<IntentClassifier>()]).default('auto'),
  entityExtractor: custom<EntityExtractor>().optional(),
  /** Video keyframe analysis (default true). */
  visual: z.boolean().default(true),
  logger: custom<Logger>().optional(),
});
export type CreateRagConfig = z.input<typeof CreateRagConfigSchema>;

export interface RagInstance extends Rag {
  config: AppConfig;
  store: VectorGraphStore;
  embedder: Embedder;
  logger: Logger;
  reranker: Reranker;
  intent: IntentClassifier;
  llm: LlmClient | null;
}

/** models/<name>/current.json -> models/<name>/vN, or null. */
export function activeModelDir(name: string): string | null {
  const root = path.join(PATHS.models, name);
  const version = currentVersion(root);
  return version ? path.join(root, `v${version}`) : null;
}

async function defaultReranker(logger: Logger): Promise<Reranker> {
  const dir = activeModelDir('reranker');
  if (!dir) {
    logger.info(
      'No promoted reranker (npm run train:reranker promotes one only if it beats the current ranking); using the pass-through baseline',
    );
    return new PassThroughReranker();
  }
  return TfjsReranker.load(dir);
}

/** The trained intent model is used only when its validation accuracy met the 0.80 target. */
async function defaultIntent(logger: Logger): Promise<IntentClassifier> {
  const dir = activeModelDir('intent');
  const reportFile = dir ? path.join(dir, 'report.json') : '';
  if (!dir || !existsSync(reportFile)) return new RuleIntentClassifier();
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as { valAccuracy: number };
  if (report.valAccuracy < 0.8) {
    logger.info(
      `Intent model validation accuracy ${report.valAccuracy.toFixed(2)} < 0.80; using rules`,
    );
    return new RuleIntentClassifier();
  }
  return TfjsIntentClassifier.load(dir);
}

/** Library entry point: { documents (CRUD), ask, feedback, close }. */
export async function createRag(input: CreateRagConfig = {}): Promise<RagInstance> {
  const options = CreateRagConfigSchema.parse(input);
  const config = loadConfig({
    ...(options.env ? { env: options.env } : {}),
    ...(options.domainDir ? { domainDir: options.domainDir } : {}),
  });
  const { env, parameters, domain } = config;
  const logger =
    options.logger ?? createLogger({ level: env.LOG_LEVEL, secrets: secretValues(env) });

  let store: VectorGraphStore;
  if (options.store === 'memory') store = new InMemoryStore();
  else if (options.store === 'neo4j') {
    if (!env.NEO4J_PASSWORD) {
      throw new ConfigError(
        'NEO4J_PASSWORD is empty. Set it in .env (8+ characters), then run npm run db:up.',
      );
    }
    store = new Neo4jStore({
      uri: env.NEO4J_URI,
      user: env.NEO4J_USER,
      password: env.NEO4J_PASSWORD,
      overFetch: parameters.retrieval.collectionOverFetch,
    });
  } else store = options.store;

  const embedder = options.embedder ?? new TransformersEmbedder();
  const tokens = options.tokens ?? (await createModelTokenCounter());
  const registry = createRegistry(env.MAX_FILE_MB * 1024 * 1024);

  const ner = new NerExtractor();
  const wikilink = new WikiLinkExtractor();
  const extractorFor = (format: string): EntityExtractor => {
    if (options.entityExtractor) return options.entityExtractor;
    const name = domain.entityExtraction.byFormat[format] ?? domain.entityExtraction.default;
    return name === 'wikilink' ? wikilink : ner;
  };

  const ocr = new TesseractOcr(parameters.media.ocrMinWordConfidence);
  const captioner = new LazyCaptioner(logger);
  const asr = new WhisperRecognizer();
  const ffmpeg = findFfmpeg(env.FFMPEG_PATH);
  const loaderContext: LoaderContext = {
    tokens,
    parameters,
    logger,
    ocr,
    captioner,
    asr,
    visual: options.visual,
    ...(ffmpeg ? { media: new FfmpegTools(ffmpeg, logger) } : {}),
  };

  let llm: LlmClient | null;
  const llmChoice = options.llm ?? (env.OPENROUTER_API_KEY ? 'openrouter' : 'none');
  if (llmChoice === 'none') llm = null;
  else if (llmChoice === 'mock') llm = new MockLlmClient();
  else if (llmChoice === 'openrouter') {
    llm = new OpenRouterClient({
      apiKey: env.OPENROUTER_API_KEY,
      ...(env.OPENROUTER_MODEL ? { model: env.OPENROUTER_MODEL } : {}),
      parameters,
      logger,
      quota: new QuotaGuard({ file: PATHS.usage, ...parameters.quota, logger }),
      modelListFile: PATHS.modelListCache,
      cacheDir: PATHS.llmCache,
    });
  } else llm = llmChoice;

  const reranker =
    options.reranker === 'auto'
      ? await defaultReranker(logger)
      : options.reranker === 'pass-through'
        ? new PassThroughReranker()
        : options.reranker;
  const intent =
    options.intent === 'auto'
      ? await defaultIntent(logger)
      : options.intent === 'rules'
        ? new RuleIntentClassifier()
        : options.intent;

  /** Wikipedia article URLs go through the REST fetch (cached in data/raw); other URLs are downloaded. */
  const resolveUrl = async (url: string, ctx: LoaderContext) => {
    const wiki = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/);
    if (wiki) {
      const title = decodeURIComponent(wiki[1]!).replace(/_/g, ' ');
      const { html, meta } = await fetchArticle(title, wikimediaUserAgent(env.WIKIMEDIA_CONTACT));
      return registry.loadFile(saveArticle(PATHS.raw, html, meta), ctx);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const type = res.headers.get('content-type') ?? '';
    const fromPath = path.extname(new URL(url).pathname).toLowerCase();
    const extension =
      fromPath || (type.includes('pdf') ? '.pdf' : type.includes('json') ? '.json' : '.html');
    const bytes = new Uint8Array(await res.arrayBuffer());
    return registry.loadBytes(
      {
        bytes,
        uri: normalizeUri(url),
        fileName: path.basename(new URL(url).pathname) || 'download',
        extension,
      },
      ctx,
    );
  };

  const { promptData, template } = loadPromptFiles(domain.answerPromptFile, domain.templateFile);
  await store.init(embedder.dimensions);
  const rag = buildRag({
    store,
    embedder,
    registry,
    tokens,
    parameters,
    domain,
    logger,
    intent,
    reranker,
    llm,
    extractorFor,
    context: async () => loaderContext,
    resolveUrl,
    promptData,
    template,
    feedbackFile: PATHS.feedback,
    singleUserMessage: env.PROMPT_SINGLE_USER_MESSAGE,
    onClose: async () => {
      await Promise.allSettled([ocr.close(), captioner.close(), ner.close(), asr.close()]);
    },
  });
  return { ...rag, config, store, embedder, logger, reranker, intent, llm };
}

export type { Rag, AskOptions, AskResult } from './core/rag.js';
export type {
  CreateInput,
  UpdateInput,
  UpdateResult,
  DocumentSource,
} from './core/document-service.js';
