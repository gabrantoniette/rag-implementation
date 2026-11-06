import type { LoaderRegistry } from '../loaders/registry.js';
import type { LoaderContext } from '../loaders/types.js';
import { type ChainState, type Mode, type Turn, initialState } from './chain.js';
import type { DomainConfig, Parameters } from './config.js';
import { DocumentService, type UrlResolver } from './document-service.js';
import { appendFeedback } from './feedback.js';
import {
  isRefusal,
  markUnsupported,
  promptSources,
  sourcesSection,
  validateStructure,
  validatedCitations,
  verifyAnswer,
} from './generation.js';
import type { Logger } from './logger.js';
import { buildRetrievalQuery, retrieve, trimHistory } from './pipeline.js';
import type {
  ChatMessage,
  Embedder,
  EntityExtractor,
  IntentClassifier,
  LlmClient,
  Reranker,
} from './ports.js';
import { type AnswerPromptData, PromptBuilder } from './prompt.js';
import type { VectorGraphStore } from './store.js';
import type { TokenCounter } from './tokens.js';

export interface RagDeps {
  store: VectorGraphStore;
  embedder: Embedder;
  registry: LoaderRegistry;
  tokens: TokenCounter;
  parameters: Parameters;
  domain: DomainConfig;
  logger: Logger;
  intent: IntentClassifier;
  reranker: Reranker;
  /** null when no API key is configured: only retrieval-only runs are possible. */
  llm: LlmClient | null;
  extractorFor: (format: string) => EntityExtractor;
  context: () => Promise<LoaderContext>;
  resolveUrl?: UrlResolver;
  promptData: AnswerPromptData;
  template: string;
  feedbackFile: string;
  singleUserMessage: boolean;
  onClose?: () => Promise<void>;
}

export interface AskOptions {
  mode?: Mode;
  collection?: string;
  history?: Turn[];
  /** Stop after context selection and the evidence gate; never calls the LLM. */
  retrievalOnly?: boolean;
  /** Skip the development LLM cache (the evidence command does). */
  bypassCache?: boolean;
}

export interface AskResult {
  state: ChainState;
  /** User-facing answer: model text with unsupported sentences marked, plus code-built Sources. */
  answer: string;
  refused: boolean;
  /** Share of answer sentences supported by their cited chunks (full mode). */
  confidence: number | null;
  /** The turn to pass as history to the next question. */
  turn: Turn;
}

export interface Rag {
  documents: DocumentService;
  ask(question: string, options?: AskOptions): Promise<AskResult>;
  feedback(result: AskResult, rating: 'up' | 'down'): Promise<void>;
  close(): Promise<void>;
}

/** Wires the pipeline stages over chain state. Adapters are passed in (see src/index.ts). */
export function buildRag(deps: RagDeps): Rag {
  const documents = new DocumentService({
    store: deps.store,
    embedder: deps.embedder,
    registry: deps.registry,
    context: deps.context,
    tokens: deps.tokens,
    parameters: deps.parameters,
    extractorFor: deps.extractorFor,
    defaultCollection: deps.domain.collection,
    logger: deps.logger,
    ...(deps.resolveUrl ? { resolveUrl: deps.resolveUrl } : {}),
  });
  const refusal = deps.promptData.refusal.insufficient_context;
  const p = deps.parameters;

  async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
    const history = trimHistory(options.history ?? [], p.memory.turns, p.memory.tokenBudget);
    const state = initialState(question, {
      mode: options.mode ?? 'full',
      collection: options.collection ?? deps.domain.collection,
      history,
    });
    state.retrievalQuery = buildRetrievalQuery(question, history);
    await retrieve(state, deps);
    const contextEntities = [...new Set(state.context.flatMap((c) => c.chunk.entities))].slice(
      0,
      5,
    );
    const done = (
      answer: string,
      refused: boolean,
      confidence: number | null,
      entities = contextEntities,
    ) => ({
      state,
      answer,
      refused,
      confidence,
      turn: { question, answer: state.answer ?? answer, entities },
    });
    if (options.retrievalOnly) return done('', false, null);

    if (state.gate?.applied && !state.gate.passed) {
      state.answer = `## Answer\n${refusal}`;
      state.warnings.push(
        'evidence gate: best reranker score below the threshold; the LLM was not called',
      );
      return done(state.answer, true, null, []);
    }
    if (!deps.llm)
      throw new Error('No LLM configured. Set OPENROUTER_API_KEY or use --retrieval-only.');

    state.prompt = PromptBuilder.build({
      promptData: deps.promptData,
      template: deps.template,
      intent: state.intent ?? 'lookup',
      history,
      sources: promptSources(state.context),
      question,
    });
    const messages: ChatMessage[] = deps.singleUserMessage
      ? [{ role: 'user', content: state.prompt }]
      : [
          { role: 'system', content: state.prompt },
          { role: 'user', content: question },
        ];
    const start = performance.now();
    const response = await deps.llm.complete({
      messages,
      temperature: p.generation.temperature,
      topP: p.generation.topP,
      maxTokens: p.generation.maxTokens,
      ...(options.bypassCache ? { bypassCache: true } : {}),
    });
    state.timings.generate = Math.round(performance.now() - start);
    state.rawAnswer = response.text.trim();
    state.model = response.model;
    if (response.usage) state.usage = response.usage;

    const structure = validateStructure(state.rawAnswer, state.context.length);
    state.warnings.push(...structure.errors.map((e) => `response: ${e}`));
    let display = state.rawAnswer;
    let confidence: number | null = null;
    if (state.mode === 'full') {
      const verifyStart = performance.now();
      state.verification = await verifyAnswer(state.rawAnswer, state.context, deps.embedder, {
        threshold: p.verification.sentenceSupportThreshold,
        passThreshold: p.verification.groundingPassThreshold,
        refusal,
      });
      state.timings.verify = Math.round(performance.now() - verifyStart);
      display = markUnsupported(display, state.verification);
      confidence = state.verification.groundingScore;
    }
    // Never regenerate: one LLM call per question. The Sources section is built here.
    state.citations = validatedCitations(state.rawAnswer, state.context);
    const sources = sourcesSection(state.citations);
    state.answer = [display, sources].filter(Boolean).join('\n\n');
    if (confidence !== null && !isRefusal(state.rawAnswer, refusal)) {
      state.answer += `\n\nConfidence: ${Math.round(confidence * 100)}% of answer sentences are supported by their cited sources.`;
    }
    const cited = new Set(state.citations.map((c) => c.chunkId));
    const citedEntities = [
      ...new Set(
        state.context.filter((c) => cited.has(c.chunk.id)).flatMap((c) => c.chunk.entities),
      ),
    ].slice(0, 5);
    return done(state.answer, isRefusal(state.rawAnswer, refusal), confidence, citedEntities);
  }

  return {
    documents,
    ask,
    async feedback(result, rating) {
      appendFeedback(deps.feedbackFile, {
        question: result.state.question,
        chunkIds: result.state.context.map((c) => c.chunk.id),
        cited: result.state.citations.map((c) => c.chunkId),
        rating,
        at: new Date().toISOString(),
      });
    },
    async close() {
      await deps.onClose?.();
      await deps.store.close();
      await deps.embedder.close();
      // Last, so lines logged while closing still reach the transport (Loki).
      await deps.logger.close?.();
    },
  };
}
