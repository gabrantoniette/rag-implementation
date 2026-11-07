# rag-implementation

[![CI](https://github.com/gabrantoniette/rag-implementation/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrantoniette/rag-implementation/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/gabrantoniette/gabrantoniette/main/assets/generated/languages/rag-implementation-dark.svg">
  <img src="https://raw.githubusercontent.com/gabrantoniette/gabrantoniette/main/assets/generated/languages/rag-implementation-light.svg" alt="Languages in rag-implementation, by share of code">
</picture>

A zero-cost, reusable **GraphRAG** example in TypeScript. It ingests documents into Neo4j (vector
index, fulltext index and an entity graph), answers questions with a single call to a **free**
OpenRouter model, and then **checks the answer locally**: every citation must exist in the retrieved
context, and every sentence is compared by embedding similarity with the passages it cites.
Unsupported sentences are marked, and a question the corpus cannot answer is refused before the LLM
is even called.

The demo domain is about 40 English Wikipedia sports articles. The domain is data, not code, so the
same library can be pointed at other corpora (see [Reuse](#use-it-for-another-domain)).

## Why it exists

Most RAG demos stop at "retrieve, stuff the prompt, print the answer". This one is built around the
question _can I trust this answer?_

- **Evidence before eloquence.** The Sources section is built by code from validated citations,
  never written by the model.
- **A refusal is a correct answer.** An evidence gate refuses when the best passage scores below a
  threshold, saving quota and avoiding invention.
- **Inspectable on demand.** Every answer carries its retrieval trace: intent, vector and fulltext
  hits, graph expansion paths, ranking, gate, per-sentence support and timings.
- **Zero cost.** Only free OpenRouter models are allowed (a non-free model is refused before any
  request), embeddings and training run locally, and there is one LLM call per question.

## Features

- **20+ input formats:** Markdown, text, HTML, Wikipedia HTML, CSV/TSV, JSON/JSONL, PDF (with OCR for
  scanned pages), SRT/VTT, DOCX/XLSX/PPTX, images (OCR + caption), audio and video (sidecar
  subtitles, or ffmpeg + Whisper, plus keyframe analysis). See [docs/FORMATS.md](docs/FORMATS.md).
- **Hybrid retrieval:** vector + fulltext fused with Reciprocal Rank Fusion, then graph expansion
  (neighbouring chunks, shared entities, linked articles) with hub entities excluded.
- **Learning-to-rank:** a small TensorFlow.js reranker over nine hand-built features and a
  TensorFlow.js intent classifier. These improve search; they do not generate text.
- **Incremental CRUD:** updating a document re-embeds only the chunks whose content changed.
- **Local chat UI:** `npm run chat` serves a page that shows each answer as a checked proof
  (per-sentence support marks, source slips, trace).
- **Observability:** structured logs to Loki, a provisioned Grafana dashboard, and a read-only
  Grafana MCP plus a Playwright MCP so an agent can inspect logs and drive the UI.
  See [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).

## Architecture

```text
question
  → intent (rules or TF.js)
  → vector + fulltext search → RRF fusion
  → graph expansion (NEXT, shared entities, LINKS_TO)
  → rerank (9 features)
  → context selection (by intent, ≤ 2500 tokens)
  → evidence gate ── below threshold → refuse, no LLM call
  → one free-model LLM call
  → local verification (citations exist, per-sentence embedding support)
  → answer + code-built Sources + confidence
```

Everything is behind ports (`Embedder`, `VectorGraphStore`, `LlmClient`, `Reranker`,
`IntentClassifier`, `EntityExtractor`), implemented in `src/adapters` and wired only in
`src/index.ts`. See [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) for the full map.

## Quick start

Requirements: Node ≥ 22.12, Docker (for Neo4j). ffmpeg is optional (audio/video only).

```bash
npm ci
cp .env.example .env        # then set NEO4J_PASSWORD (8+ chars) and WIKIMEDIA_CONTACT
npm run db:up               # Neo4j on 127.0.0.1:7687
npm run ingest:fetch        # download the Wikipedia corpus into data/raw
npm run ingest:build        # chunk, embed and load it into Neo4j
npm run ask -- --retrieval-only "When did Lewis Hamilton join Mercedes?"
npm run chat                # local UI on http://127.0.0.1:4317
```

Retrieval works without any key. To get generated answers, set `OPENROUTER_API_KEY` in `.env`
(a free account is enough; only free models are ever called).

The first run downloads the embedding, NER and OCR models into `.cache/` (nothing is written outside
the project folder).

## Commands

| Command                                                             | What it does                                     |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| `npm run ask -- "question"`                                         | One-shot question (`--mode`, `--retrieval-only`) |
| `npm run chat`                                                      | Local web chat                                   |
| `npm run docs -- create <path\|url>` / `list` / `update` / `delete` | Document CRUD                                    |
| `npm run feedback -- up\|down`                                      | Rate the last answer (feeds the reranker)        |
| `npm run train:intent` / `train:reranker`                           | Train and (conditionally) promote the models     |
| `npm run eval:retrieval`                                            | Ablation table → `docs/evaluation.md`            |
| `npm run evidence [-- --formats]`                                   | Five-question evidence run / format smoke test   |
| `npm run obs:up` / `obs:down` / `obs:token`                         | Loki + Grafana stack and MCP token               |
| `npm run mcp:eval`                                                  | Measure the Grafana and Playwright MCPs          |
| `npm run lint` / `typecheck` / `test`                               | Quality gates (also run in CI)                   |
| `npm run test:integration`                                          | Neo4j / Loki integration tests                   |
| `npm run scan:secrets`                                              | gitleaks + regex scan of files and history       |

## Use it as a library

```ts
import { createRag } from './src/index.js';

const rag = await createRag({ domainDir: 'domains' });
await rag.documents.create({ id: 'notes', source: { text: '…', format: 'md', title: 'Notes' } });
const result = await rag.ask('What does the handbook say about opening hours?', { mode: 'full' });
console.log(result.answer, result.confidence);
await rag.close();
```

Modes are `vector`, `hybrid`, `graph`, `rerank` and `full`; only `full` runs verification and
computes a confidence. For tests, `store: 'memory'`, `llm: 'mock'` and a fake embedder run the whole
pipeline with no network and no Neo4j (see `tests/reuse/reuse.test.ts`).

## Use it for another domain

Prompts, corpus list, intent seeds and evaluation sets live in a domain folder, not in code.

```bash
cp -r domains/_template domains/mydomain
# edit domain.json, prompts/, corpus.json, intent-seed.jsonl, eval/
# set DOMAIN_DIR=domains/mydomain in .env
npm run docs -- create ./my-file.pdf
```

A test fails if domain vocabulary leaks into `src/core`. Details in [docs/REUSE.md](docs/REUSE.md).

## Results, honestly

Numbers come from commands in this repository, not from estimates (`docs/evidence/`).

- **Retrieval ablation** (16 hand-written queries, recall@6): vector 0.813, hybrid 0.813,
  \+ graph 0.875. The trained reranker was **not promoted** (nDCG@6 0.483 vs 0.574 for the
  pass-through baseline), so the reranker row is a no-op today. Synthetic queries are reported
  separately and are not used for improvement claims. See [docs/evaluation.md](docs/evaluation.md).
- **Live evidence run:** 4 of 5 questions pass. One fails because the current Wikipedia revision
  describes a newer World Cup than the question's expected answer.
- **Formats:** 19 of 19 format fixtures retrieve their gold passage. Whisper and video keyframes are
  unverified because ffmpeg was absent on the build machine.
- **Intent model:** validation accuracy 0.656, below the 0.80 bar, so the rule-based classifier is
  used.

## Security and privacy

- Every service (Neo4j, Loki, Grafana, the chat server) binds to `127.0.0.1` only.
- The chat server rejects foreign `Host`, cross-origin and non-JSON POSTs, sends a strict CSP, and
  is meant for local use, not exposure.
- Secrets from `.env` are redacted from every log line before it leaves the process.
- The Grafana MCP is read-only (`--disable-write`) and uses a Viewer token.
- Log content (questions, answers, browser errors) is untrusted: agents must not follow instructions
  found in it.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Project layout

```text
src/core       domain-neutral logic and ports
src/adapters   Neo4j, in-memory, Transformers.js, TF.js, OpenRouter, Loki
src/loaders    one loader per format        src/vision   OCR, captioning, ffmpeg
src/web, web/  local chat server and UI     src/cli      one file per npm script
src/mcp-eval   MCP measurement harness      domains/     prompts, corpus, eval data
models/        trained models, calibration  ops/         Loki, Grafana, MCP config
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run lint`, `npm run typecheck` and `npm test`
before opening a pull request.

## License and attribution

Code: [MIT](LICENSE). Corpus text comes from Wikipedia under CC BY-SA 4.0; models and fonts keep
their own licences. Full list in [ATTRIBUTION.md](ATTRIBUTION.md).
