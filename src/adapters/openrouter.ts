import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_TITLE, APP_URL } from '../config/app-info.js';
import type { Parameters } from '../core/config.js';
import { ConfigError, LlmHttpError, ModelNotAllowedError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';
import type { Logger } from '../core/logger.js';
import type { LlmClient, LlmRequest, LlmResponse } from '../core/ports.js';
import type { QuotaGuard } from './quota.js';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Attribution headers (non-sensitive constants). The title alone does not create an app page. */
export const ATTRIBUTION_HEADERS = {
  'HTTP-Referer': APP_URL,
  'X-OpenRouter-Title': APP_TITLE,
} as const;

export interface ModelInfo {
  id: string;
  context_length: number;
  pricing: Record<string, string | undefined>;
  architecture?: { output_modalities?: string[] };
}

const isZero = (v: string | undefined) => v === undefined || Number(v) === 0;

/**
 * Free text models with a large enough context: prompt, completion and request prices all zero, and
 * text as the only output (a model that also returns audio or images is not a text model).
 */
export function freeModels(models: ModelInfo[], minContext: number): ModelInfo[] {
  return models.filter((m) => {
    const outputs = m.architecture?.output_modalities ?? ['text'];
    return (
      isZero(m.pricing.prompt) &&
      isZero(m.pricing.completion) &&
      isZero(m.pricing.request) &&
      m.pricing.prompt !== undefined &&
      m.pricing.completion !== undefined &&
      m.context_length >= minContext &&
      outputs.length === 1 &&
      outputs[0] === 'text'
    );
  });
}

/**
 * Official free variants (':free' ids and the free router) come first. Other zero-priced ids are
 * usually stealth or preview models: still allowed when pinned, never auto-picked over the former.
 */
const isOfficialFree = (id: string, freeRouterId: string) =>
  id.endsWith(':free') || id === freeRouterId;

export interface OpenRouterOptions {
  apiKey: string;
  /** OPENROUTER_MODEL; still checked against the allowlist. */
  model?: string;
  parameters: Parameters;
  logger: Logger;
  quota: QuotaGuard;
  modelListFile: string;
  cacheDir: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * OpenRouter chat completions over fetch (no SDK). Zero-cost lock: the request is refused before it
 * is sent unless the model is a discovered free model or exactly 'openrouter/free'.
 */
export class OpenRouterClient implements LlmClient {
  private allowlist: Promise<{ ids: Set<string>; preferred: string }> | null = null;

  constructor(private readonly o: OpenRouterOptions) {
    if (!o.apiKey) {
      throw new ConfigError('OPENROUTER_API_KEY is empty. Copy .env.example to .env and set it.');
    }
  }

  private fetch() {
    return this.o.fetchImpl ?? fetch;
  }

  /** Model listing, cached for 24 hours inside the project folder (no request counted). */
  async listModels(): Promise<ModelInfo[]> {
    const ttl = this.o.parameters.llm.modelListTtlHours * 3600_000;
    const now = this.o.now?.() ?? Date.now();
    if (existsSync(this.o.modelListFile)) {
      const cached = JSON.parse(readFileSync(this.o.modelListFile, 'utf8')) as {
        at: number;
        data: ModelInfo[];
      };
      if (now - cached.at < ttl) return cached.data;
    }
    const res = await this.fetch()(`${OPENROUTER_BASE}/models`, {
      headers: { ...ATTRIBUTION_HEADERS },
    });
    if (!res.ok) throw new LlmHttpError(res.status, 'model listing failed');
    const json = (await res.json()) as { data: ModelInfo[] };
    mkdirSync(path.dirname(this.o.modelListFile), { recursive: true });
    writeFileSync(this.o.modelListFile, JSON.stringify({ at: now, data: json.data }));
    return json.data;
  }

  /**
   * Discovered free models plus the exact id 'openrouter/free'; preferred = an official free variant
   * with the largest context (see isOfficialFree), then any other free model.
   */
  allowedModels(): Promise<{ ids: Set<string>; preferred: string }> {
    this.allowlist ??= (async () => {
      const llm = this.o.parameters.llm;
      const official = (m: ModelInfo) => (isOfficialFree(m.id, llm.freeRouterId) ? 0 : 1);
      const free = freeModels(await this.listModels(), llm.minContextLength).sort(
        (a, b) =>
          official(a) - official(b) ||
          b.context_length - a.context_length ||
          a.id.localeCompare(b.id),
      );
      const ids = new Set([...free.map((m) => m.id), llm.freeRouterId]);
      return { ids, preferred: free[0]?.id ?? llm.freeRouterId };
    })();
    return this.allowlist;
  }

  async resolveModel(): Promise<string> {
    const { ids, preferred } = await this.allowedModels();
    const model = this.o.model || preferred;
    if (!ids.has(model)) throw new ModelNotAllowedError(model);
    return model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = await this.resolveModel();
    const body = {
      model,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
    };
    const key = sha256(JSON.stringify(body));
    const cacheFile = path.join(this.o.cacheDir, `${key}.json`);
    if (!request.bypassCache && existsSync(cacheFile)) {
      return { ...(JSON.parse(readFileSync(cacheFile, 'utf8')) as LlmResponse), cached: true };
    }
    const g = this.o.parameters.generation;
    let attempt = 0;
    for (;;) {
      await this.o.quota.acquire();
      const res = await this.fetch()(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.o.apiKey}`,
          'Content-Type': 'application/json',
          ...ATTRIBUTION_HEADERS,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(g.timeoutSeconds * 1000),
      });
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < g.retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        this.o.logger.warn(
          `OpenRouter HTTP ${res.status}; retry ${attempt + 1}/${g.retries} in ${backoff} ms`,
        );
        await (this.o.wait ?? sleep)(backoff);
        attempt++;
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        model?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      if (!res.ok || json.error) {
        throw new LlmHttpError(res.status, json.error?.message ?? 'request failed');
      }
      const response: LlmResponse = {
        text: json.choices?.[0]?.message?.content ?? '',
        model: json.model ?? model,
        ...(json.usage
          ? {
              usage: {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              },
            }
          : {}),
        cached: false,
      };
      mkdirSync(this.o.cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(response));
      return response;
    }
  }
}
