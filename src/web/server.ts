import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import { MODES, type Mode } from '../core/chain.js';
import { ConfigError, LlmHttpError, QuotaExceededError } from '../core/errors.js';
import { askEventFields } from '../core/events.js';
import type { Logger } from '../core/logger.js';
import { PATHS, projectPath } from '../core/paths.js';
import type { AskResult } from '../core/rag.js';
import type { RagInstance } from '../index.js';
import { serializableState } from '../cli/format.js';
import { type AnswerView, type CompareView, answerView, compareEntry } from './present.js';

/**
 * Local chat server: serves web/ and a small JSON API over the library (createRag). It binds to
 * 127.0.0.1 only and is not meant to be exposed: the spec's non-goal "no production HTTP server"
 * still holds.
 */

const TurnSchema = z.object({
  question: z.string().max(2000),
  answer: z.string().max(20_000),
  entities: z.array(z.string().max(300)).max(20),
});

const AskSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  mode: z.enum(MODES as [Mode, ...Mode[]]).default('full'),
  retrievalOnly: z.boolean().default(false),
  history: z.array(TurnSchema).max(10).default([]),
  collection: z.string().trim().min(1).max(100).optional(),
});

const CompareSchema = AskSchema.pick({ question: true, history: true, collection: true });

const FeedbackSchema = z.object({ id: z.string().uuid(), rating: z.enum(['up', 'down']) });

/** An error report from the page (window.onerror / unhandledrejection in web/app.js). */
const ClientLogSchema = z.object({
  message: z.string().min(1).max(2000),
  source: z.string().max(500).optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  stack: z.string().max(8000).optional(),
  page: z.string().max(200).optional(),
});

/** Client error reports accepted per rolling minute, across all pages. */
const CLIENT_LOGS_PER_MINUTE = 30;

const STATIC: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface ErrorBody {
  error: string;
  kind:
    | 'input'
    | 'no-key'
    | 'quota'
    | 'llm'
    | 'store'
    | 'config'
    | 'not-found'
    | 'rate-limit'
    | 'forbidden'
    | 'internal';
  hint?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

/** Maps library errors to a status code, a kind the page can style, and a recovery hint. */
export function describeError(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) return { status: error.status, body: error.body };
  const e = error as Error & { code?: string };
  if (error instanceof QuotaExceededError)
    return { status: 429, body: { error: e.message, kind: 'quota' } };
  if (error instanceof LlmHttpError)
    return {
      status: 502,
      body: {
        error: e.message,
        kind: 'llm',
        hint: 'The free model may be rate limited or offline. Try again in a minute, or run retrieval only.',
      },
    };
  if (error instanceof ConfigError)
    return { status: 503, body: { error: e.message, kind: 'config' } };
  if (
    e?.code === 'ServiceUnavailable' ||
    /ECONNREFUSED|Could not perform discovery/i.test(e?.message ?? '')
  )
    return {
      status: 503,
      body: {
        error: 'The Neo4j database is not reachable.',
        kind: 'store',
        hint: 'Start it with npm run db:up, then try again.',
      },
    };
  if (/No LLM configured/.test(e?.message ?? ''))
    return {
      status: 400,
      body: {
        error: 'No OpenRouter key is configured, so answers cannot be generated.',
        kind: 'no-key',
        hint: 'Set OPENROUTER_API_KEY in .env and restart, or run retrieval only.',
      },
    };
  return { status: 500, body: { error: e?.message ?? String(error), kind: 'internal' } };
}

/**
 * Only the chat page itself may use the API. Any website the user has open could otherwise POST
 * to 127.0.0.1 (a "simple" text/plain request needs no CORS preflight) and spend quota or write
 * log lines that an agent later reads through the Grafana MCP. Checks, in order:
 * - Host is 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding), on every request;
 * - on POST: Origin, when sent, is this server's own origin; Sec-Fetch-Site, when sent, is
 *   same-origin or none; and the body is declared as application/json.
 */
export function requestGate(
  req: IncomingMessage,
  port: number,
): { status: number; body: ErrorBody } | null {
  const forbidden = (error: string) => ({
    status: 403,
    body: { error, kind: 'forbidden' as const },
  });
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes((req.headers.host ?? '').toLowerCase()))
    return forbidden('Unknown Host header; open the page at http://127.0.0.1.');
  if (req.method !== 'POST') return null;
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin.toLowerCase() === `http://${h}`))
    return forbidden('Cross-origin requests are not accepted.');
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    return forbidden('Cross-site requests are not accepted.');
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
    return {
      status: 415,
      body: { error: 'Send the request body as application/json.', kind: 'input' },
    };
  return null;
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit)
      throw new HttpError(413, { error: 'Request body is too large.', kind: 'input' });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, { error: 'Request body is not valid JSON.', kind: 'input' });
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, {
      error: `Invalid request: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`.trim(),
      kind: 'input',
    });
  }
  return result.data;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

function quotaToday(file: string): number {
  if (!existsSync(file)) return 0;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { date?: string; count?: number };
    return data.date === new Date().toISOString().slice(0, 10) ? (data.count ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** The active domain's evaluation questions, offered as first questions on an empty page. */
function suggestions(evalDir: string): string[] {
  const file = path.join(evalDir, 'questions.json');
  if (!existsSync(file)) return [];
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as { question?: string }[];
    return list.map((q) => q.question).filter((q): q is string => typeof q === 'string');
  } catch {
    return [];
  }
}

export interface ChatServerOptions {
  /** Called once on the first request that needs the library; retried after a failure. */
  createRag: () => Promise<RagInstance>;
  port?: number;
  webDir?: string;
  usageFile?: string;
  lastAskFile?: string | null;
  /** Results kept in memory for feedback, newest last. */
  keepResults?: number;
  /** Where request, ask and browser events go; defaults to the library's logger once loaded. */
  logger?: Logger;
}

export interface ChatServer {
  url: string;
  close(): Promise<void>;
}

export async function startChatServer(options: ChatServerOptions): Promise<ChatServer> {
  const webDir = path.resolve(options.webDir ?? projectPath('web'));
  const usageFile = options.usageFile ?? PATHS.usage;
  const lastAskFile = options.lastAskFile === undefined ? PATHS.lastAsk : options.lastAskFile;
  const keep = options.keepResults ?? 50;
  const results = new Map<string, AskResult>();
  let ragPromise: Promise<RagInstance> | null = null;
  let lastModel: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let ragLogger: Logger | null = null;
  const clientLogTimes: number[] = [];

  const getRag = () => {
    ragPromise ??= options
      .createRag()
      .then((rag) => {
        ragLogger = rag.logger;
        return rag;
      })
      .catch((error: unknown) => {
        ragPromise = null;
        // Only an injected logger can report this: the library's own never came to exist.
        log()?.error('library failed to load', {
          event: 'rag.load_failed',
          error: describeError(error).body.error,
        });
        throw error;
      });
    return ragPromise;
  };

  /** The injected logger, else the library's (null until the library has loaded). */
  function log(): Logger | null {
    return options.logger ?? ragLogger;
  }

  /** The embedder and TF.js models are single-threaded: run library calls one at a time. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const remember = (result: AskResult) => {
    const id = randomUUID();
    results.set(id, result);
    while (results.size > keep) results.delete(results.keys().next().value!);
    return id;
  };

  async function status() {
    try {
      const rag = await getRag();
      const p = rag.config.parameters;
      return {
        ready: true,
        domain: rag.config.domain.name,
        collection: rag.config.domain.collection,
        hasKey: rag.llm !== null,
        model: rag.config.env.OPENROUTER_MODEL || null,
        lastModel,
        quota: {
          used: quotaToday(usageFile),
          warnAt: p.quota.warnAt,
          blockAt: p.quota.blockAt,
          perMinute: p.quota.perMinute,
        },
        reranker: rag.reranker.name,
        intent: rag.intent.name,
        memoryTurns: p.memory.turns,
        thresholds: {
          support: p.verification.sentenceSupportThreshold,
          pass: p.verification.groundingPassThreshold,
          gate: p.evidenceGate.threshold,
        },
        modes: MODES,
        suggestions: suggestions(rag.config.domain.evalDir),
      };
    } catch (error) {
      const { body } = describeError(error);
      return { ready: false, error: body.error, kind: body.kind, hint: body.hint ?? null };
    }
  }

  async function ask(input: z.infer<typeof AskSchema>): Promise<AnswerView> {
    const rag = await getRag();
    const result = await serial(() =>
      rag.ask(input.question, {
        mode: input.mode,
        retrievalOnly: input.retrievalOnly,
        history: input.history,
        ...(input.collection ? { collection: input.collection } : {}),
      }),
    );
    if (result.state.model) lastModel = result.state.model;
    if (lastAskFile) {
      mkdirSync(path.dirname(lastAskFile), { recursive: true });
      writeFileSync(lastAskFile, JSON.stringify(serializableState(result.state), null, 2));
    }
    const id = remember(result);
    log()?.info('ask completed', askEventFields(result, { source: 'chat', id }));
    return answerView(id, result, {
      retrievalOnly: input.retrievalOnly,
      refusal: refusalText(rag),
      parameters: rag.config.parameters,
    });
  }

  async function compare(input: z.infer<typeof CompareSchema>): Promise<CompareView> {
    const rag = await getRag();
    const modes: CompareView['modes'] = [];
    for (const mode of MODES) {
      const result = await serial(() =>
        rag.ask(input.question, {
          mode,
          retrievalOnly: true,
          history: input.history,
          ...(input.collection ? { collection: input.collection } : {}),
        }),
      );
      modes.push(compareEntry(result.state));
    }
    return { question: input.question, modes };
  }

  async function serveStatic(res: ServerResponse, urlPath: string) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    const file = path.resolve(webDir, rel);
    const type = STATIC[path.extname(file).toLowerCase()];
    if (!file.startsWith(webDir + path.sep) || !type || !existsSync(file)) {
      send(res, 404, { error: 'Not found.', kind: 'not-found' });
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': type.startsWith('font/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  }

  async function clientLog(input: z.infer<typeof ClientLogSchema>) {
    const logger = log() ?? (await getRag()).logger;
    (logger.with?.({ service: 'rag-browser' }) ?? logger).warn('browser error', {
      event: 'browser.error',
      ...input,
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;
    const started = performance.now();
    let askQuestion: string | undefined;
    const gate = requestGate(req, (server.address() as AddressInfo).port);
    if (gate) {
      log()?.warn('request refused', {
        event: 'http.refused',
        method: req.method,
        route: url.pathname,
        status: gate.status,
        reason: gate.body.error,
      });
      return send(res, gate.status, gate.body);
    }
    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'warn' : 'info';
      log()?.[level]('http request', {
        event: 'http.request',
        method: req.method,
        route: url.pathname,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    const handle = async () => {
      switch (route) {
        case 'GET /api/status':
          return send(res, 200, await status());
        case 'POST /api/ask': {
          const input = parse(AskSchema, await readJson(req));
          askQuestion = input.question;
          return send(res, 200, await ask(input));
        }
        case 'POST /api/client-log': {
          const now = Date.now();
          while (clientLogTimes.length && now - clientLogTimes[0]! > 60_000) clientLogTimes.shift();
          if (clientLogTimes.length >= CLIENT_LOGS_PER_MINUTE)
            throw new HttpError(429, {
              error: 'Too many client error reports; try again in a minute.',
              kind: 'rate-limit',
            });
          clientLogTimes.push(now);
          await clientLog(parse(ClientLogSchema, await readJson(req, 16 * 1024)));
          res.writeHead(204, { 'cache-control': 'no-store' });
          return res.end();
        }
        case 'POST /api/compare':
          return send(res, 200, await compare(parse(CompareSchema, await readJson(req))));
        case 'POST /api/feedback': {
          const input = parse(FeedbackSchema, await readJson(req));
          const result = results.get(input.id);
          if (!result)
            throw new HttpError(404, {
              error: 'That answer is no longer in memory (the server keeps the last 50).',
              kind: 'not-found',
            });
          const rag = await getRag();
          await rag.feedback(result, input.rating);
          log()?.info('feedback saved', {
            event: 'feedback.saved',
            id: input.id,
            rating: input.rating,
            question: result.state.question,
            cited: result.state.citations.length,
          });
          return send(res, 200, { saved: true, rating: input.rating });
        }
        default:
          if (req.method === 'GET' && !url.pathname.startsWith('/api/'))
            return serveStatic(res, url.pathname);
          throw new HttpError(404, { error: 'Not found.', kind: 'not-found' });
      }
    };
    handle().catch((error: unknown) => {
      const { status: code, body } = describeError(error);
      if (code >= 500) process.stderr.write(`[chat] ${route}: ${body.error}\n`);
      if (code >= 500 && askQuestion !== undefined)
        log()?.error('ask failed', {
          event: 'ask.failed',
          kind: body.kind,
          error: body.error,
          question: askQuestion,
        });
      if (!res.headersSent) send(res, code, body);
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (ragPromise) await (await ragPromise.catch(() => null))?.close();
    },
  };
}

const refusals = new WeakMap<RagInstance, string>();

/** The domain's refusal sentence (domains/<name>/prompts/answer.json), read once per instance. */
function refusalText(rag: RagInstance): string {
  let text = refusals.get(rag);
  if (text === undefined) {
    const data = JSON.parse(readFileSync(rag.config.domain.answerPromptFile, 'utf8')) as {
      refusal?: { insufficient_context?: string };
    };
    text = data.refusal?.insufficient_context ?? '';
    refusals.set(rag, text);
  }
  return text;
}
