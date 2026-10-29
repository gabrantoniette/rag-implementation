# Dependencies

Every library below was looked up in the context7 MCP before code was written against it.
"Version" is the version resolved by npm for this repository (see `package-lock.json`).
Lookup date for all rows: 2026-10-29.

## Runtime

| Package                   | Version        | context7 id                    | Used for                                                     |
| ------------------------- | -------------- | ------------------------------ | ------------------------------------------------------------ |
| @huggingface/transformers | 4.3.2          | /huggingface/transformers.js   | Embeddings, NER, Whisper ASR, Florence-2 captions, tokenizer |
| neo4j-driver              | 6.3.0          | /neo4j/neo4j-javascript-driver | Neo4j access                                                 |
| (Neo4j Cypher manual)     | server 5.26.31 | /websites/neo4j                | Vector and fulltext index syntax                             |
| @tensorflow/tfjs          | 4.22.0         | /tensorflow/tfjs               | Intent classifier and reranker training (CPU, pure JS)       |
| (OpenRouter HTTP API)     | n/a            | /websites/openrouter_ai        | Model listing, chat completions, limits, attribution headers |
| zod                       | 4.6.7          | /colinhacks/zod                | Config and data validation                                   |
| dotenv                    | 18.0.9         | /motdotla/dotenv               | `.env` loading                                               |
| cheerio                   | 1.2.0          | /cheeriojs/cheerio             | HTML and Wikipedia parsing                                   |
| unpdf                     | 2.0.0          | /unjs/unpdf                    | PDF text per page, page rendering for OCR                    |
| csv-parse                 | 7.0.3          | /adaltas/node-csv              | CSV and TSV                                                  |
| officeparser              | 8.4.0          | /harshankur/officeparser       | docx, xlsx, pptx                                             |
| tesseract.js              | 7.0.0          | /naptha/tesseract.js           | OCR (English)                                                |
| @napi-rs/canvas           | 1.0.13         | /brooooooklyn/canvas           | Canvas for unpdf rendering, PNG test fixtures                |

## Development

| Package           | Version | context7 id        | Note                                                                                                               |
| ----------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| typescript        | 6.0.3   | n/a                | 7.0.2 is `latest`, but typescript-eslint 8.72.1 declares `typescript >=4.8.4 <6.1.0` as a peer, so 6.0.x is pinned |
| tsx               | 4.23.15 | /privatenumber/tsx | Runs scripts, no build step                                                                                        |
| vitest            | 5.0.5   | /vitest-dev/vitest | Unit and integration tests (requires Node ^22.12, ^24 or >=26)                                                     |
| eslint            | 10.13.0 | n/a                | Flat config                                                                                                        |
| typescript-eslint | 8.72.1  | n/a                |                                                                                                                    |
| prettier          | 3.9.10  | n/a                |                                                                                                                    |
| @types/node       | 26.6.6  | n/a                |                                                                                                                    |
| jszip             | 3.10.2  | n/a                | Test fixtures only (OOXML packages)                                                                                |

Fallback-only packages (mammoth, read-excel-file) are NOT installed unless officeparser fails a
P3 acceptance check; any such addition is recorded below with the reason.

## External programs

| Program     | Status on the build machine (2026-10-29)                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Node.js     | v26.8.1 (npm 12.0.2)                                                                                      |
| Docker      | 29.7.2, Docker Desktop engine (8 CPUs, ~10 GB RAM)                                                        |
| Neo4j image | `neo4j:5.26.31-community` (5.26 is the LTS line of 5.x; tag verified on Docker Hub, published 2026-10-06) |
| ffmpeg      | ABSENT (not on PATH, `FFMPEG_PATH` unset). Audio and video paths degrade with `MediaToolMissingError`.    |

## Models (verified on the Hugging Face model cards and repository files)

| Model                             | Task                               | License (from card)                                                         | Files checked                                                     |
| --------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Xenova/bge-small-en-v1.5          | feature-extraction, 384 dims       | MIT (upstream BAAI/bge-small-en-v1.5; the Xenova card has no license field) | `onnx/model_quantized.onnx` (dtype q8)                            |
| Xenova/all-MiniLM-L6-v2           | fallback embedder                  | Apache-2.0                                                                  | `onnx/model_quantized.onnx`                                       |
| Xenova/bert-base-NER              | token-classification               | MIT                                                                         | `onnx/model_quantized.onnx`                                       |
| Xenova/whisper-tiny.en            | automatic-speech-recognition       | Apache-2.0 (upstream openai/whisper-tiny.en)                                | encoder, decoder_model_merged                                     |
| onnx-community/Florence-2-base-ft | image-text-to-text                 | MIT (upstream microsoft/Florence-2-base-ft)                                 | embed_tokens, vision_encoder, encoder_model, decoder_model_merged |
| Xenova/vit-gpt2-image-captioning  | image-to-text (fallback captioner) | Apache-2.0 (upstream nlpconnect/vit-gpt2-image-captioning)                  | encoder_model, decoder_model_merged                               |

## Facts verified at build time (and mismatches with the build prompt)

- **BGE pooling.** `BAAI/bge-small-en-v1.5/1_Pooling/config.json` sets `pooling_mode_cls_token: true`, and the
  BAAI card says to take the `[CLS]` hidden state. The Xenova card's example uses `pooling: 'mean'`.
  This repository follows the upstream model (CLS + L2 normalization), as the build prompt asks.
- **BGE query prefix.** `Represent this sentence for searching relevant passages: ` confirmed on the BAAI card
  for queries only.
- **Transformers.js cache.** `env.cacheDir` overrides the default cache (which is inside `node_modules`);
  this repository sets it to `.cache/transformers` in the project folder.
- **Transformers.js pooling options.** `'none' | 'mean' | 'cls' | 'first_token' | 'eos' | 'last_token'`.
- **Florence-2.** Loaded with `Florence2ForConditionalGeneration` + `AutoProcessor` + `AutoTokenizer`,
  `processor.construct_prompts(task)`, `processor.post_process_generation(text, task, image.size)`.
  The docs show per-module dtypes (`embed_tokens`, `vision_encoder`, `encoder_model`, `decoder_model_merged`)
  because the encoder is sensitive to quantization.
- **Neo4j.** `CREATE VECTOR INDEX name IF NOT EXISTS FOR (n:Label) ON n.prop OPTIONS { indexConfig: {
\`vector.dimensions\`: 384, \`vector.similarity_function\`: 'cosine' } }`and`db.index.vector.queryNodes(index, k, vector)`. The current Cypher manual marks `queryNodes` as deprecated
  in Neo4j 2026.04 (calendar versioning); it is the supported API on the pinned 5.26 line.
- **neo4j-driver.** `disableLosslessIntegers: true` returns native numbers; `session.executeWrite` gives
  one transaction with automatic retries.
- **OpenRouter limits.** Free variants: 20 requests/minute; 50/day with fewer than 10 credits purchased,
  1000/day with at least 10. The daily counter resets at **UTC midnight** (OpenRouter SDK docs,
  `FreeModelDailyRequests`). The quota guard uses the UTC date.
- **OpenRouter attribution.** `X-OpenRouter-Title` (with `X-Title` accepted as legacy) must be paired with
  `HTTP-Referer`; the title alone does not create an app page.
- **OpenRouter model listing.** The API reference lists a Bearer header for `GET /api/v1/models`, but the
  listing answered without a key on 2026-10-29 (456 models, 19 with zero prompt and completion price,
  including `openrouter/free` with a 200,000-token context). Some zero-price entries are not text models
  (for example `google/lyria-3-pro-preview`, a music model), so the allowlist also requires `text` in
  `architecture.output_modalities` (deviation from the prompt, which filters on price and context only).
- **tesseract.js 7.** Supported image formats: bmp, jpg, png, pbm, webp, gif (non-animated), so all five
  image extensions in the prompt are kept. Since v6 every output except `text` is disabled by default;
  word confidences need `worker.recognize(image, {}, { blocks: true })`. `langPath` and `cachePath`
  options exist on `createWorker`.
- **officeparser 8.4.** `parseOffice(file, config)` returns an AST; `decompressionLimits` has
  `maxUncompressedBytes` (default 512 MB) and `maxZipEntries` (default 10,000), plus a 1,000,000-cell
  spreadsheet cap. officeparser 8.4 depends on tesseract.js ^7 (same major as ours).
- **unpdf 2.0.** `extractText(data, { mergePages: false })` returns `{ totalPages, text: string[] }`;
  `renderPageAsImage(data, page, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 })` returns
  PNG bytes. Peer dependency `@napi-rs/canvas ^0.1.69 || ^1.0.0`.
- **csv-parse 7.** Options `columns`, `skip_empty_lines`, `bom`, `relax_column_count` exist. The context7
  autodocs describe `relax_column_count` as discarding mismatched records; a local run on 2026-10-29 showed
  that it KEEPS short rows (missing columns absent) and drops fields beyond the header, with
  `info.invalid_field_length` counting them. The CSV loader relies on the observed behaviour.

## Install notes

- `.npmrc` points the npm cache at `.cache/npm` inside the project (folder lock).
- npm 12 blocks dependency install scripts that are not in `allowScripts`. Blocked on this machine:
  `onnxruntime-node` (downloads optional CUDA binaries on Linux only; the Windows CPU binaries ship in the
  package), `esbuild` (binary check; the platform binary comes from `@esbuild/win32-x64`), `protobufjs`,
  `core-js` and `tesseract.js` (messages only). Nothing in this project needs them, so they stay blocked.
- `scripts/tsx.mjs` runs every TypeScript entry point through tsx with `TMP`, `TEMP` and `TMPDIR` set to
  `.cache/tmp`, because tsx keeps a persistent transform cache in the OS temp folder by default.
  `vitest.config.ts` applies the same rule to the test runner.
- **officeparser fallbacks.** officeparser 8.4 passed every P3 acceptance check (docx heading path and
  footnotes, xlsx sheets with cached formula values, pptx slides with speaker notes, decompression limit,
  corrupt file), so `mammoth` and `read-excel-file` were NOT added. The loader passes `fileType` from the
  extension (magic bytes are checked first) because officeparser's own sniffing reported a minimal
  OOXML package as a plain ZIP. Its limit error reads "ZIP uncompressed size limit exceeded (N bytes)".
