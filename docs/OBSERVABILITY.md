# Observability: logs in Loki, a live Grafana dashboard and two MCPs

The CLI and the chat server can ship every log event to a local **Loki**. **Grafana** shows them
live, and two **MCP servers** let an agent (Claude Code or the evaluation harness) work with them:

- the **Grafana MCP** reads the stored logs and dashboards (read-only);
- the **Playwright MCP** opens the chat page in a headless browser, uses it, and reads the console
  and network.

Everything runs on your machine and listens on `127.0.0.1` only: Neo4j, Loki, Grafana and the chat
server.

## 1. Start the stack

1. In `.env`, set `GRAFANA_ADMIN_PASSWORD` (12+ characters) and
   `LOKI_URL=http://127.0.0.1:3100`.
2. Start Neo4j, Loki and Grafana:

   ```bash
   npm run obs:up
   ```

   `npm run db:up` still starts Neo4j alone. `npm run obs:down` stops the three.

3. Create the read-only token for the Grafana MCP:

   ```bash
   npm run obs:token
   ```

   It creates (or reuses) the Grafana service account `rag-mcp` with the **Viewer** role and writes
   a new token, valid for 90 days, to `GRAFANA_SERVICE_ACCOUNT_TOKEN` in `.env`. It never prints the
   token. Run it again when the token expires.

**Memory.** Measured on 2026-11-06: Grafana about 270 MB at idle (limit 512 MB), Loki about 45 MB
(limit 512 MB), Neo4j about 1.5 GB. The chat server adds the embedding models (about 1.5 GB) and
the Playwright MCP adds a headless Chrome. On a machine short of memory, run `npm run obs:down` when
you are done.

## 2. What gets logged

With `LOKI_URL` set, every log line also goes to Loki as JSON. Logs stay on the terminal as before,
and if Loki is down the application keeps working (lines are dropped with one warning).

Loki labels (few, so queries stay fast): `service` (`rag-cli`, `rag-chat`, `rag-browser`), `level`,
`domain` and `env` (`LOG_ENV`, default `dev`). Everything else is a JSON field:

| `event`          | Where                             | Fields                                                                                                                                                                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ask.completed`  | `npm run ask` and the chat page   | `status` (answered, refused, held, retrieval), `mode`, `intent`, `gatePassed`, `groundingScore`, `supported`, `queried`, `model`, tokens, `totalMs`, `timings`, **`question` and `answer` text**, `citations` |
| `ask.failed`     | chat page                         | `kind`, `error`, `question`                                                                                                                                                                                   |
| `http.request`   | chat server                       | `method`, `route`, `status`, `ms`                                                                                                                                                                             |
| `feedback.saved` | `npm run feedback`, chat page     | `rating`, `question`, `cited`                                                                                                                                                                                 |
| `quota.warning`  | OpenRouter client                 | `kind` (daily, per-minute), `used`, `warnAt`, `blockAt`                                                                                                                                                       |
| `browser.error`  | chat page (`service=rag-browser`) | `message`, `source`, `line`, `column`, `stack`, `page`                                                                                                                                                        |

Secrets from `.env` (OpenRouter key, Neo4j password, Grafana password and token) and anything shaped
like a key are replaced by `[REDACTED]` before a line leaves the process, including inside question
text. Long text fields are cut at 32 KB and marked `truncated: true`.

The chat page reports its own JavaScript errors to `POST /api/client-log` (at most 10 per page load;
the server accepts at most 30 per minute).

## 3. The dashboard

Open http://127.0.0.1:3000 (user `admin`, the password from `.env`), then **Dashboards > RAG >
RAG observability**. It refreshes every 10 seconds and shows the log stream, errors per minute, asks
by status, ask latency (p95), mean grounding and browser errors. Traffic from the evaluation harness
(`env=eval`) is hidden.

## 4. The two MCPs

`.mcp.json` declares both servers. Agents load it when a session starts, so restart Claude Code
after the first setup. Both start through small Node launchers, so the same file works on Windows,
macOS and Linux:

- `scripts/mcp-grafana.mjs` runs `grafana/mcp-grafana:2.1.1` in Docker with `-t stdio
--disable-write` and every tool category off except search, datasources, Loki, dashboards,
  navigation, queries and examples (17 tools). It reads only `GRAFANA_SERVICE_ACCOUNT_TOKEN` from
  `.env` and passes it to the container through the environment, never as an argument.
- `scripts/mcp-playwright.mjs` runs `@playwright/mcp` 0.0.84 headless, with an in-memory profile,
  writing to `.playwright-mcp/`. `ops/playwright-mcp.config.json` lets the browser open only
  `http://localhost:*` and `http://127.0.0.1:*`. It needs Google Chrome installed
  (`npx playwright install chrome` if it is missing).

## 5. Measuring the MCPs: `npm run mcp:eval`

```bash
npm run obs:up        # once
npm run obs:token     # once (and every 90 days)
npm run mcp:eval      # add -- --live to use OpenRouter (at most 1 request)
```

The harness starts the chat server (answers come from the mock LLM, so no quota is used), connects
to both MCPs with the official MCP client using the commands in `.mcp.json`, and runs three
scenarios:

- **grafana:** asks a question carrying a unique marker, then polls `query_loki_logs` until the
  `ask.completed` line appears. It checks the line has the question, the answer and no secret, and
  that no write tool is exposed. Measured: start-up, time until the line is visible, and query
  latency (p50, p95).
- **playwright:** opens the chat page, types the question, waits for the checked answer, then reads
  console errors and the `/api/` requests. It fails on any console error or HTTP status of 400 or
  more. Measured: start-up, total time and number of tool calls.
- **security:** checks the chat page headers (CSP, `nosniff`, `no-referrer`), path traversal, that
  the chat server listens on 127.0.0.1, and that every port the compose stack publishes is bound
  to loopback.

A scenario that cannot run (no Docker, no Chrome, no token) is reported as **not covered**, never
as passed. The report goes to `docs/evidence/mcp-<date>.md` and `.json`. The pass limits are in
`ops/mcp-eval.thresholds.json`, with the record of how they were calibrated.
