# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS served by a native Node HTTP server (`node:http`), no new npm dependencies. The server serves the page and a JSON API that calls the existing `createRag()` library entry point. Runs locally only: it needs the Neo4j container, the local Transformers.js models and the optional OpenRouter key. Started with an npm script (`npm run chat`).

## Users

Primary: technical evaluators: the author and developers who clone the public repository. They want to ask the sports corpus questions in plain English, read a structured answer, check each claim against its cited source, and open the retrieval trace on demand (vector, fulltext, graph expansion, rerank, evidence gate) to understand why the system answered or refused. Non-technical end users are not the audience of this surface.

## Product Purpose

A zero-cost, reusable GraphRAG example in TypeScript. Answer quality comes first: it understands questions that do not repeat the source wording, follows relations between subjects through a knowledge graph, and returns answers grounded in retrieved documents with verified citations. The chat interface makes that pipeline usable and inspectable without the CLI. It succeeds when an evaluator can ask a question, trust or reject each sentence by looking at its evidence, and see the system refuse when the corpus does not hold the answer.

## Positioning

Every answer is checked locally, without a second LLM call: citations must exist in the retrieved context, each sentence is compared by embedding similarity with the chunks it cites, unsupported sentences are marked, and a confidence share is reported. An evidence gate refuses before calling the LLM when the best rerank score is below a threshold. The Sources section is built by code from validated citations, never written by the model.

## Operating Context

- Local developer machine (Windows 11 and Linux), Node >= 22.12, Neo4j 5 in Docker (`npm run db:up`).
- Corpus: about 40 English Wikipedia articles across football, basketball, tennis, Formula One and athletics/Olympics (`domains/corpus.json`), CC BY-SA 4.0.
- The existing CLI (`npm run ask`, `npm run feedback`) is the reference workflow; the web UI calls the same library functions.
- Domains are swappable (`domains/`, `docs/REUSE.md`); the first planned reuse is a LinkedIn-posts domain, so the UI must not hard-code sports vocabulary.

## Capabilities and Constraints

- `rag.ask(question, { mode, collection, history, retrievalOnly })` returns the answer (Markdown with `## Answer`, `## Key points`, code-built `## Sources`), `refused`, `confidence` and the full chain state: intent, vector and fulltext hits, graph expansion paths, ranked candidates, context chunks, evidence gate, citations, per-sentence verification, model, token usage, timings and warnings.
- Modes: `vector`, `hybrid`, `graph`, `rerank`, `full`. Only `full` runs verification and confidence.
- Retrieval-only runs work without an API key; generation needs `OPENROUTER_API_KEY`. Only free OpenRouter models are allowed (zero-cost lock).
- Free tier quota: about 20 requests per minute and 50 per day, counted in `data/usage.json` and blocked near the limit. One LLM call per question, never regenerated.
- Conversation memory: last 3 turns, about 800 tokens; short or pronoun follow-ups inherit the previous answer's entities.
- Feedback: `rag.feedback(result, 'up' | 'down')` appends to `data/feedback.jsonl`; `npm run train:reranker` retrains and promotes a model only if it does not get worse on validation.
- Live answers take about 5 to 18 seconds (see `docs/evidence/live-2026-11-04.md`); the OpenRouter client does not stream.
- Spec non-goal kept: no production HTTP server. This is a local tool, not a hosted service.
- Interface language: English (matches corpus, questions and README; the repository will be public).

## Brand Commitments

- Name: `rag-implementation`. No logo or visual identity exists.
- Voice: honest and exact. The README and UI must not call TensorFlow.js "generative AI" or claim the system "learns by itself"; the trained parts are a learning-to-rank reranker and an intent classifier.

## Evidence on Hand

- Live evidence run, 2026-11-04: 4 of 5 questions pass, model `nvidia/nemotron-3-ultra-550b-a55b:free` (`docs/evidence/live-2026-11-04.md`, `.json`).
- Retrieval ablation (`docs/evidence/ablation-2026-11-04.json`, `docs/evaluation.md`).
- Five evaluation questions and twenty hand-written retrieval queries (`domains/eval/`).
- No users, testimonials or usage metrics exist; none may be invented.

## Product Principles

1. Evidence before eloquence: a claim is only as visible as its support; unsupported sentences stay marked, never hidden.
2. A refusal is a correct answer when the corpus lacks the fact, and it must read as such, not as an error.
3. Inspectable on demand: the answer leads; the pipeline trace is one step away, never in the way.
4. Domain-neutral: the interface works for any domain folder, not just sports.
5. Honest about limits: quota, missing key, gate thresholds and model identity are shown plainly.

## Accessibility & Inclusion

No product-specific requirement established; WCAG 2.2 AA as the working floor.
