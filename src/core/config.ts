import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { PROJECT_ROOT, projectPath } from './paths.js';

/** Empty strings in .env mean "not set", so they fall back to the default. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

export const EnvSchema = z.object({
  NEO4J_URI: optional(z.string().default('bolt://localhost:7687')),
  NEO4J_USER: optional(z.string().default('neo4j')),
  NEO4J_PASSWORD: optional(z.string().default('')),
  OPENROUTER_API_KEY: optional(z.string().default('')),
  OPENROUTER_MODEL: optional(z.string().default('')),
  WIKIMEDIA_CONTACT: optional(z.string().default('')),
  FFMPEG_PATH: optional(z.string().default('')),
  DOMAIN_DIR: optional(z.string().default('domains')),
  LOG_LEVEL: optional(z.enum(['debug', 'info', 'warn', 'error']).default('info')),
  /** Loki base URL; empty keeps logs on the terminal only. */
  LOKI_URL: optional(z.string().default('')),
  /** The env label on shipped log lines (dev, eval, ...): short, lowercase, low cardinality. */
  LOG_ENV: optional(
    z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .default('dev'),
  ),
  /** Read only so the logger can scrub them; the application never uses them. */
  GRAFANA_ADMIN_PASSWORD: optional(z.string().default('')),
  GRAFANA_SERVICE_ACCOUNT_TOKEN: optional(z.string().default('')),
  MAX_FILE_MB: optional(z.coerce.number().positive().default(50)),
  /** true (default): send the whole prompt as one user message; some free models reject 'system'. */
  PROMPT_SINGLE_USER_MESSAGE: optional(
    z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  ),
});
export type Env = z.infer<typeof EnvSchema>;

const ExtractorName = z.enum(['wikilink', 'ner']);

export const DomainSchema = z.object({
  name: z.string().min(1),
  collection: z.string().min(1),
  language: z.literal('en').default('en'),
  entityExtraction: z
    .object({
      default: ExtractorName.default('ner'),
      byFormat: z.record(z.string(), ExtractorName).default({}),
    })
    .default({ default: 'ner', byFormat: {} }),
});
export type DomainSettings = z.infer<typeof DomainSchema>;

export interface DomainConfig extends DomainSettings {
  dir: string;
  promptsDir: string;
  answerPromptFile: string;
  templateFile: string;
  corpusFile: string;
  intentSeedFile: string;
  evalDir: string;
}

/** Starting values from the build prompt; calibrated values (models/calibration.json) override some. */
export const DEFAULT_PARAMETERS = {
  chunking: {
    targetTokens: 300,
    maxTokens: 400,
    overlapTokens: 50,
    minTokens: 60,
    droppedSections: ['References', 'External links', 'See also', 'Notes', 'Further reading'],
  },
  retrieval: {
    vectorTopK: 30,
    fulltextTopK: 30,
    rrfK: 60,
    candidatesAfterFusion: 20,
    finalKByIntent: { lookup: 4, explain: 6, compare: 8, timeline: 8 },
    contextTokenCap: 2500,
    hubDegreeThreshold: 150,
    graphSeedCount: 5,
    /** Vector and fulltext queries over-fetch by this factor, then filter by collection. */
    collectionOverFetch: 3,
  },
  generation: {
    temperature: 0.2,
    topP: 0.9,
    maxTokens: 700,
    timeoutSeconds: 60,
    retries: 2,
  },
  verification: {
    sentenceSupportThreshold: 0.65,
    groundingPassThreshold: 0.8,
  },
  evidenceGate: {
    /** Placeholder until calibration writes models/calibration.json. */
    threshold: 0.5,
  },
  memory: { turns: 3, tokenBudget: 800 },
  quota: { warnAt: 40, blockAt: 45, perMinute: 20 },
  llm: { minContextLength: 32_000, modelListTtlHours: 24, freeRouterId: 'openrouter/free' },
  media: {
    ocrPageMinChars: 40,
    ocrMinWordConfidence: 60,
    subtitleWindowMaxSeconds: 90,
    warnAudioMinutes: 30,
    visual: {
      maxFrames: 60,
      sceneThreshold: 0.3,
      minIntervalSeconds: 30,
      frameMaxWidth: 1024,
      dedupHammingMax: 5,
    },
  },
};
export type Parameters = typeof DEFAULT_PARAMETERS;

const CalibrationSchema = z
  .object({
    hubDegreeThreshold: z.number().int().positive().optional(),
    evidenceGateThreshold: z.number().optional(),
    sentenceSupportThreshold: z.number().optional(),
  })
  .partial();
export type Calibration = z.infer<typeof CalibrationSchema>;

export const CALIBRATION_FILE = projectPath('models', 'calibration.json');

export interface AppConfig {
  env: Env;
  parameters: Parameters;
  domain: DomainConfig;
}

export interface LoadConfigOptions {
  /** Explicit environment (tests). When omitted, process.env plus the project .env file is used. */
  env?: Record<string, string | undefined>;
  /** Read the project .env file (default true when env is omitted). */
  readDotenv?: boolean;
  /** Override DOMAIN_DIR. */
  domainDir?: string;
  /** Apply models/calibration.json (default true). */
  applyCalibration?: boolean;
}

function readEnv(options: LoadConfigOptions): Record<string, string | undefined> {
  if (options.env) return options.env;
  const fromFile: Record<string, string> = {};
  if (options.readDotenv !== false) {
    dotenv.config({ path: projectPath('.env'), quiet: true, processEnv: fromFile });
  }
  // Real environment variables win over the .env file.
  return { ...fromFile, ...process.env };
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success)
    throw new ConfigError(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export function loadDomain(dir: string): DomainConfig {
  const abs = path.isAbsolute(dir) ? dir : path.join(PROJECT_ROOT, dir);
  const file = path.join(abs, 'domain.json');
  if (!existsSync(file)) throw new ConfigError(`Domain folder '${dir}' has no domain.json.`);
  const result = DomainSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!result.success) {
    throw new ConfigError(`Invalid ${file}:\n${z.prettifyError(result.error)}`);
  }
  const promptsDir = path.join(abs, 'prompts');
  return {
    ...result.data,
    dir: abs,
    promptsDir,
    answerPromptFile: path.join(promptsDir, 'answer.json'),
    templateFile: path.join(promptsDir, 'template.txt'),
    corpusFile: path.join(abs, 'corpus.json'),
    intentSeedFile: path.join(abs, 'intent-seed.jsonl'),
    evalDir: path.join(abs, 'eval'),
  };
}

export function readCalibration(file = CALIBRATION_FILE): Calibration {
  if (!existsSync(file)) return {};
  const result = CalibrationSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!result.success) throw new ConfigError(`Invalid ${file}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export function applyCalibration(base: Parameters, calibration: Calibration): Parameters {
  const p: Parameters = structuredClone(base);
  if (calibration.hubDegreeThreshold !== undefined) {
    p.retrieval.hubDegreeThreshold = calibration.hubDegreeThreshold;
  }
  if (calibration.evidenceGateThreshold !== undefined) {
    p.evidenceGate.threshold = calibration.evidenceGateThreshold;
  }
  if (calibration.sentenceSupportThreshold !== undefined) {
    p.verification.sentenceSupportThreshold = calibration.sentenceSupportThreshold;
  }
  return p;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = parseEnv(readEnv(options));
  const domain = loadDomain(options.domainDir ?? env.DOMAIN_DIR);
  const parameters =
    options.applyCalibration === false
      ? structuredClone(DEFAULT_PARAMETERS)
      : applyCalibration(DEFAULT_PARAMETERS, readCalibration());
  return { env, parameters, domain };
}

/** Exact secret values the logger must scrub. */
export function secretValues(env: Env): string[] {
  return [
    env.OPENROUTER_API_KEY,
    env.NEO4J_PASSWORD,
    env.GRAFANA_ADMIN_PASSWORD,
    env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
  ].filter((s) => s.length > 0);
}
