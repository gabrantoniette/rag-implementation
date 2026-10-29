# Domain template

A domain is a folder with this layout. Select it with `DOMAIN_DIR=domains/<name>` in `.env`
(or `createRag({ domainDir })`). Nothing in `src/` is specific to any domain.

| File                       | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `domain.json`              | Name, default collection, entity extractor per format                                 |
| `prompts/answer.json`      | Prompt data: role, task, rules, citation rules, intent instructions, refusal sentence |
| `prompts/template.txt`     | Prompt template; every `{placeholder}` must have a value                              |
| `corpus.json`              | Wikipedia articles for `npm run ingest:fetch` (optional for other sources)            |
| `intent-seed.jsonl`        | Hand-written queries for `npm run train:intent` (aim for 150+, 35+ per class)         |
| `eval/retrieval-eval.json` | Hand-written retrieval eval set (`npm run eval:retrieval`)                            |
| `eval/questions.json`      | Evidence questions (`npm run evidence`)                                               |

See `docs/REUSE.md` for a walkthrough.
