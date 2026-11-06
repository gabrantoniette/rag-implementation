# Before making the repository public

Work through this list before the first push to a public repository (or before switching a private
one to public).

## Identity and URLs

- [ ] Confirm `APP_URL` in `src/config/app-info.ts` matches the final repository URL (it is sent to
      OpenRouter as `HTTP-Referer`).
- [ ] Fill the copyright holder in `LICENSE` (currently `<COPYRIGHT HOLDER>`).
- [ ] Decide about commit author emails. Every commit so far records the email from your
      `git config user.email` (author and committer metadata, not file content). If you do not want it
      public, rewrite the history before the first public push (for example with `git filter-repo`
      and a mailmap to your GitHub `noreply` address) and enable GitHub's "Block command line pushes
      that expose my email". `npm run scan:secrets` lists the distinct emails in its metadata section.

## Secrets and data

- [ ] `npm run scan:secrets` reports `TOTAL FINDINGS: 0` (gitleaks plus the regex scan of tracked
      files and the whole history).
- [ ] `git status --ignored` shows `.env`, `data/raw`, `data/cache`, `data/usage.json`,
      `data/feedback.jsonl`, `.cache`, `.neo4j-data`, `.loki-data`, `.grafana-data` and
      `.playwright-mcp` as ignored, never staged.
- [ ] `.env.example` still has empty values for `OPENROUTER_API_KEY`, `NEO4J_PASSWORD`,
      `WIKIMEDIA_CONTACT`, `GRAFANA_ADMIN_PASSWORD` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`. Your own
      `.env` holds the Grafana admin password and the Viewer token for the Grafana MCP: never copy
      them into `.mcp.json` or any tracked file.
- [ ] `docs/evidence/mcp-*.md` and `tests/fixtures/mcp/query-loki-logs.json` hold logged questions
      and answers from the evaluation run; skim them once.
- [ ] `docs/evidence/` and `docs/project-record/` contain no key, email or personal data (they are
      generated from command output; skim them once).

## Licences and attribution

- [ ] `ATTRIBUTION.md` lists the Wikipedia articles and the CC BY-SA 4.0 notice, and the licence of
      every model used.
- [ ] Raw Wikipedia HTML stays out of git (`data/raw` is ignored); anyone can rebuild it with
      `npm run ingest:fetch`.

## Quality

- [ ] CI (`.github/workflows/ci.yml`) is green: lint, typecheck and unit tests.
- [ ] README numbers match `docs/evaluation.md`, and the README never calls TensorFlow.js generative.
- [ ] The project record Artifact (`docs/project-record/ARTIFACT_URL.txt`) is shared only if you want
      it public (Artifacts start private).

## First push (private)

```bash
gh repo create rag-implementation --private --source . --push
```
