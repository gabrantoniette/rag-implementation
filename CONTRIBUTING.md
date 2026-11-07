# Contributing

Thanks for your interest. This is a small, opinionated example project; focused changes are easiest
to review.

## Setup

```bash
npm ci
cp .env.example .env
```

Unit tests need no Neo4j and no API key (`npm test`). The first run downloads some small models into
`.cache/`.

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run scan:secrets   # needs Docker for the gitleaks layer
```

CI runs lint, typecheck and the unit tests, plus a secret scan, on every pull request.

## Ground rules

- **Zero cost.** Never add a paid model or a paid fallback; only free OpenRouter models are allowed.
- **Domain-neutral core.** No domain vocabulary in `src/core` (a test enforces it). Prompts and
  domain data live in `domains/<name>/`.
- **Ports and adapters.** New capability = an interface in `src/core`, an implementation in
  `src/adapters`, wiring only in `src/index.ts`.
- **No fabricated results.** Numbers in docs come from commands; files in `docs/evidence/` are
  generated, not hand-edited. TensorFlow.js parts are a reranker and an intent classifier, never
  "generative".
- **Tests with the change.** Use the fakes in `tests/helpers/` so tests run offline.
- **Prettier checks `docs/` too.** Format generated markdown and JSON before committing.

See [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) for where to change what.
