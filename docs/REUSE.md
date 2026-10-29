# Reusing this repository for another domain

Everything specific to the sports example lives in `domains/` (the sports domain folder). The code in
`src/` knows nothing about sports; `tests/reuse/reuse.test.ts` fails if a sports word appears in
`src/core`, and it runs `createRag` on `domains/_template` with in-memory adapters.

This guide creates a `linkedin` domain (for example, for a LinkedIn agents project).

## 1. Copy the template

```bash
cp -r domains/_template domains/linkedin
```

| File                       | What to change                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `domain.json`              | `name: "linkedin"`, `collection: "linkedin"`. Keep `entityExtraction.default: "ner"` (posts have no hyperlinks to articles).      |
| `prompts/answer.json`      | Role, task, tone, instructions, intent instructions and the refusal sentence, in the language you answer in.                      |
| `prompts/template.txt`     | Optional. Every `{placeholder}` must have a value or the build fails with `PromptBuildError`.                                     |
| `intent-seed.jsonl`        | 150+ queries, 35+ per class (`lookup`, `explain`, `compare`, `timeline`), phrased the way your users ask.                         |
| `eval/retrieval-eval.json` | About 15 hand-written queries with gold `{ title, section }` passages, plus a few on-topic questions the documents cannot answer. |
| `eval/questions.json`      | Five evidence questions (see the sports ones in `domains/eval/questions.json`).                                                   |
| `corpus.json`              | Only needed if you fetch Wikipedia articles with `npm run ingest:fetch`.                                                          |

## 2. Point the commands at the domain

Set it in `.env` (all CLI commands read it):

```bash
DOMAIN_DIR=domains/linkedin
```

Or pass it in code:

```ts
import { createRag } from './src/index.js';

const rag = await createRag({ domainDir: 'domains/linkedin' });
await rag.documents.create({ source: { path: 'exports/posts-2026.csv' } });
const result = await rag.ask('Which post about hiring got the most comments?');
console.log(result.answer);
await rag.close();
```

## 3. Load documents

Any supported format works (see `docs/FORMATS.md`): CSV or JSON exports of posts, Markdown notes,
PDFs, slide decks, recordings with subtitles.

```bash
npm run db:up
npm run docs -- create exports/posts-2026.csv
npm run docs -- create notes/strategy.md --title "Content strategy"
npm run docs -- list
```

Documents get the domain's collection by default. Collections are a property in Neo4j (community
edition has one database), so several domains can share one database; queries filter by
collection after over-fetching 3x.

## 4. Train and evaluate

```bash
npm run train:intent      # uses domains/linkedin/intent-seed.jsonl
npm run train:reranker    # synthetic pairs from your documents + feedback; calibrates thresholds
npm run eval:retrieval    # ablation table into docs/evaluation.md
npm run ask -- --retrieval-only "your question"
npm run evidence          # retrieval-only without a key, live with OPENROUTER_API_KEY
```

The intent model only replaces the keyword rules if its validation accuracy reaches 0.80. A new
reranker replaces the current one only if nDCG@6 is no worse on both evaluation sets.

## 5. Things to know

- **English only.** The embedding model (`Xenova/bge-small-en-v1.5`), NER, Whisper and OCR settings
  are English. For another language, swap the embedding model in `src/adapters/embedder.ts` (and
  re-index: the vector index dimension must match), the NER model and the tesseract language.
- **Calibration is per corpus.** `models/calibration.json` (evidence gate and sentence support)
  comes from your own eval set; re-run `npm run train:reranker` after loading a new corpus.
- **Entity extraction.** Wikipedia articles use their hyperlinks (`WikiLinkExtractor`); every other
  format uses `NerExtractor`. Override per format in `domain.json`.
