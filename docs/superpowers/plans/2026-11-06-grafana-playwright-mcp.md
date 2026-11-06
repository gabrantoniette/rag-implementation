# Observabilidade com Grafana MCP e Playwright MCP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Armazenar os logs do CLI e do chat num Loki local, mostrá-los ao vivo num painel do Grafana, expor os dois MCPs no projeto e provar a eficiência deles com um harness de avaliação.

**Architecture:**

- Loki e Grafana entram no `docker-compose.yml` sob o perfil `observability`, todos presos a `127.0.0.1`.
- O logger existente ganha um destino Loki opcional, que envia JSON em lotes. Ele nunca bloqueia nem derruba a aplicação.
- O servidor de chat e o CLI emitem eventos estruturados.
- `.mcp.json` inicia os dois MCPs por wrappers Node.
- `npm run mcp:eval` conecta aos MCPs reais com o SDK cliente do MCP, mede e grava um relatório em `docs/evidence/`.

**Tech Stack:**

- Já no projeto: TypeScript (ESM, tsx), Node ≥ 22.12, vitest, zod, dotenv.
- Novos no Docker: `grafana/loki` 3.x, `grafana/grafana`, `grafana/mcp-grafana`.
- Novas dependências de desenvolvimento: `@playwright/mcp` 0.0.84 e `@modelcontextprotocol/client` 2.4.0.

**Spec:** `docs/superpowers/specs/2026-11-05-grafana-playwright-mcp-design.md`

## Global Constraints

- Neo4j (7474, 7687), Loki (3100), Grafana (3000) e o chat (4317) publicados **só em `127.0.0.1`**.
- Nenhum segredo no Git. Os novos segredos vão só no `.env` e ficam vazios no `.env.example`: `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`.
- Configurações novas no `.env` (não secretas): `LOKI_URL`, `LOG_ENV` (padrão `dev`).
- O MCP do Grafana roda com `--disable-write`, com token de uma conta de serviço **Viewer**.
- O MCP do Playwright roda `--headless` e `--isolated`, e só navega para `http://localhost:*` e `http://127.0.0.1:*`.
- O Loki guarda metadados **e o texto da pergunta e da resposta**. A máscara de segredos (`redact`) roda antes de qualquer envio.
- Rótulos do Loki, só estes: `service` (`rag-cli` | `rag-chat` | `rag-browser`), `level`, `domain`, `env`. Todo o resto vai como campo do JSON.
- Com o Loki fora do ar a aplicação funciona normalmente. O envio nunca bloqueia uma pergunta, e `close()` termina em até 2 s.
- Testes não gastam cota do OpenRouter. O padrão é o `MockLlmClient`; `--live` faz no máximo 1 pergunta real.
- Cada contêiner tem `mem_limit`. Loki com retenção de 168h.
- Versões fixadas e registradas em `docs/dependencies.md`, com id do Context7 e data de consulta 2026-11-05.
- Continuam valendo: `npm run lint` (eslint + prettier, que verifica também `docs/`), `npm run typecheck`, `npm test`, `npm run scan:secrets`, e `src/core` livre de vocabulário de esportes (teste de reuso).
- Arquivos que o código gera em `docs/` saem já formatados pelo Prettier, como em `src/cli/eval-retrieval.ts:86-89`.

## Review Focus

1. **Loki fora do ar quando alguém roda `npm run chat` sem o stack.** A pergunta responde normalmente e o processo encerra sem travar. O teste está na Task 3 (`close resolves within 2s when Loki is unreachable`).
2. **Um segredo colado no texto da pergunta** (chave `sk-or-…` ou token `glsa_…`). Ele chega mascarado ao Loki. O teste está na Task 4 (`redacts secrets inside question text sent to the transport`).
3. **Token do Grafana ausente ou vazio.** O wrapper sai com código 1 e uma mensagem clara, e o harness marca o cenário como "sem cobertura", sem quebrar. Os testes estão na Task 7 (`mcp-grafana wrapper exits 1 without a token`) e na Task 9 (cenário `covered: false`).
4. **Tempestade de erros no navegador** (um erro em loop). O cliente envia no máximo 10 por página, o servidor recusa acima de 30 por minuto com 429, e o chat continua respondendo. O teste está na Task 6 (`rate-limits client logs with 429`).
5. **Linha de log grande demais** (resposta longa ou stack enorme). O `/api/client-log` recusa corpo acima do limite, e o destino Loki corta campos de texto acima de 32 KB, marcando `truncated: true`. Os testes estão na Task 3 (`truncates long text fields`) e na Task 6 (`rejects oversized client logs`).

---

### Task 1: Docker — Neo4j em loopback, Loki e Grafana no perfil `observability`

**Files:**

- Modify: `docker-compose.yml`
- Create: `ops/loki/loki.yaml`
- Create: `src/cli/obs.ts`
- Modify: `package.json` (scripts `obs:up`, `obs:down`)
- Modify: `.env.example`, `.gitignore`
- Test: `tests/unit/ops.test.ts`

**Interfaces:**

- Produces: serviços `loki` (`http://127.0.0.1:3100`) e `grafana` (`http://127.0.0.1:3000`); scripts `npm run obs:up` e `npm run obs:down`.

- [ ] **Step 1: Write the failing test** in `tests/unit/ops.test.ts`

```ts
it('publishes every compose port on 127.0.0.1 only', () => {
  const compose = readFileSync(projectPath('docker-compose.yml'), 'utf8');
  const ports = [...compose.matchAll(/^\s*-\s*'([^']+)'\s*$/gm)]
    .map((m) => m[1]!)
    .filter((p) => /:\d+$/.test(p));
  expect(ports.length).toBeGreaterThanOrEqual(4); // 7474, 7687, 3100, 3000
  for (const p of ports) expect(p.startsWith('127.0.0.1:')).toBe(true);
});
it('keeps loki and grafana behind the observability profile with memory limits', () => {
  const compose = readFileSync(projectPath('docker-compose.yml'), 'utf8');
  for (const name of ['loki', 'grafana']) {
    const block = compose.split(new RegExp(`^  ${name}:`, 'm'))[1]!.split(/^  \w/m)[0]!;
    expect(block).toMatch(/profiles:\s*\[\s*'?observability'?\s*\]/);
    expect(block).toMatch(/mem_limit:/);
  }
});
it('sets 168h retention in the Loki config', () => {
  const loki = readFileSync(projectPath('ops', 'loki', 'loki.yaml'), 'utf8');
  expect(loki).toMatch(/retention_period:\s*168h/);
  expect(loki).toMatch(/retention_enabled:\s*true/);
  expect(loki).toMatch(/auth_enabled:\s*false/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ops.test.ts`
Expected: FAIL. The ports `'7474:7474'` don't start with `127.0.0.1:`, and `ops/loki/loki.yaml` doesn't exist.

- [ ] **Step 3: Implement the compose services and the Loki config**
  - **Neo4j:** `'127.0.0.1:7474:7474'` and `'127.0.0.1:7687:7687'`.
  - **`loki`:**
    - image `grafana/loki:<tag 3.x fixed>` (consult `/websites/grafana_loki` for the tag and config).
    - `profiles: ['observability']`, port `'127.0.0.1:3100:3100'`, `mem_limit: 512m`.
    - command `-config.file=/etc/loki/loki.yaml`.
    - volumes `./ops/loki/loki.yaml:/etc/loki/loki.yaml:ro` and `./.loki-data:/loki`.
    - healthcheck on `/ready`.
  - **`grafana`:**
    - image `grafana/grafana:<tag fixed>`, `profiles: ['observability']`, port `'127.0.0.1:3000:3000'`, `mem_limit: 384m`.
    - `depends_on: loki: condition: service_healthy`.
    - environment: `GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-}`, `GF_AUTH_ANONYMOUS_ENABLED: 'false'`, `GF_USERS_ALLOW_SIGN_UP: 'false'`, `GF_ANALYTICS_REPORTING_ENABLED: 'false'`, `GF_ANALYTICS_CHECK_FOR_UPDATES: 'false'`.
    - volumes `./ops/grafana/provisioning:/etc/grafana/provisioning:ro`, `./ops/grafana/dashboards:/var/lib/grafana/dashboards:ro` and `./.grafana-data:/var/lib/grafana`.
  - **`ops/loki/loki.yaml`:**
    - monolithic mode: `auth_enabled: false`, `server.http_listen_port: 3100`.
    - `common.storage.filesystem` under `/loki`; `schema_config` with `store: tsdb`, `object_store: filesystem`, `schema: v13`, `index.period: 24h`.
    - `compactor.retention_enabled: true` with `delete_request_store: filesystem`; `limits_config.retention_period: 168h`.
- [ ] **Step 4: Implement `src/cli/obs.ts`** (`up` | `down`)
  - `up`: refuses with exit code 1 and the message `GRAFANA_ADMIN_PASSWORD is empty. Set it in .env (12+ characters) before npm run obs:up.` when the variable is empty or shorter than 12. Otherwise runs `docker compose --profile observability up -d --wait`.
  - `down`: runs `docker compose --profile observability down`.
  - Scripts: `"obs:up": "node scripts/tsx.mjs src/cli/obs.ts up"`, `"obs:down": "node scripts/tsx.mjs src/cli/obs.ts down"`.
  - `.env.example`: add `GRAFANA_ADMIN_PASSWORD=`, `GRAFANA_SERVICE_ACCOUNT_TOKEN=`, `LOKI_URL=` (commented `# http://127.0.0.1:3100 after npm run obs:up`) and `LOG_ENV=dev`.
  - `.gitignore`: add `.loki-data/`, `.grafana-data/`, `.playwright-mcp/`.
- [ ] **Step 5: Run the test and the stack**
  - Run: `npx vitest run tests/unit/ops.test.ts`. Expected: PASS.
  - Run: `npm run db:up`, then `docker compose ps`. Expected: only `neo4j`, with ports `127.0.0.1:7474->7474` and `127.0.0.1:7687->7687`.
  - Run: `npm run obs:up`, then `curl -s http://127.0.0.1:3100/ready`. Expected: `ready`.
  - Run: `curl -s http://127.0.0.1:3000/api/health`. Expected: `"database": "ok"`.
- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml ops/loki/loki.yaml src/cli/obs.ts package.json .env.example .gitignore tests/unit/ops.test.ts
git commit -m "feat(ops): local Loki and Grafana behind the observability profile; Neo4j on loopback"
```

### Task 2: Grafana provisioning — Loki datasource and live dashboard

**Files:**

- Create: `ops/grafana/provisioning/datasources/loki.yaml`
- Create: `ops/grafana/provisioning/dashboards/provider.yaml`
- Create: `ops/grafana/dashboards/rag-observability.json`
- Test: `tests/unit/ops.test.ts` (append)

**Interfaces:**

- Consumes: the `loki` service from Task 1 (`http://loki:3100` on the compose network).
- Produces: datasource `uid: loki`. Dashboard `uid: rag-observability`, titled "RAG observability".
- Uses the event fields from Tasks 4 to 6: `event`, `status`, `totalMs`, `groundingScore`.

- [ ] **Step 1: Write the failing test**

```ts
it('provisions a dashboard whose every query targets Loki and hides eval traffic', () => {
  const dash = JSON.parse(
    readFileSync(projectPath('ops/grafana/dashboards/rag-observability.json'), 'utf8'),
  );
  expect(dash.uid).toBe('rag-observability');
  expect(dash.refresh).toBe('10s');
  const targets = dash.panels.flatMap((p: { targets?: unknown[] }) => p.targets ?? []);
  expect(targets.length).toBeGreaterThanOrEqual(6);
  for (const t of targets as { datasource: { uid: string }; expr: string }[]) {
    expect(t.datasource.uid).toBe('loki');
    expect(t.expr).toContain('env!="eval"');
  }
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run tests/unit/ops.test.ts -t dashboard`. Expected: FAIL, ENOENT.
- [ ] **Step 3: Write the provisioning files**
  - **Datasource:** `name: Loki`, `type: loki`, `uid: loki`, `url: http://loki:3100`, `access: proxy`, `isDefault: true`, `editable: false`.
  - **Provider:** points to `/var/lib/grafana/dashboards` with `allowUiUpdates: false`.
  - **Dashboard:** `refresh: "10s"`, `time.from: "now-1h"`, `tags: ["rag"]`. Six panels, each with these exact LogQL `expr` values:
    - Logs: `{service=~"rag-.*", env!="eval"} | json`
    - Errors per minute: `sum(count_over_time({service=~"rag-.*", env!="eval", level="error"}[1m]))`
    - Asks by status: `sum by (status) (count_over_time({service=~"rag-.*", env!="eval"} | json | event="ask.completed" [5m]))`
    - Ask latency p95: `quantile_over_time(0.95, {service=~"rag-.*", env!="eval"} | json | event="ask.completed" | unwrap totalMs [5m]) by (service)`
    - Mean grounding: `avg_over_time({service=~"rag-.*", env!="eval"} | json | event="ask.completed" | unwrap groundingScore [15m]) by (service)`
    - Browser errors: `{service="rag-browser", env!="eval"} | json`
- [ ] **Step 4: Run the test and check in Grafana**
  - Run: `npx vitest run tests/unit/ops.test.ts`. Expected: PASS.
  - Run: `docker compose --profile observability restart grafana`.
  - Run: `curl -s -u admin:$GRAFANA_ADMIN_PASSWORD http://127.0.0.1:3000/api/datasources/uid/loki/health`. Expected: `"status":"OK"`.
  - Run: `curl -s -u admin:$GRAFANA_ADMIN_PASSWORD http://127.0.0.1:3000/api/dashboards/uid/rag-observability`. Expected: HTTP 200.
- [ ] **Step 5: Commit** `git commit -m "feat(ops): provision Loki datasource and live RAG dashboard"`

### Task 3: Loki transport

**Files:**

- Create: `src/adapters/loki.ts`
- Modify: `src/core/logger.ts` (only the types and `truncateFields`, which belong to the core and are used in Task 4)
- Test: `tests/unit/loki.test.ts`

**Interfaces:**

- Produces, in `src/core/logger.ts`:
  - `interface LogTransport { send(entry: TransportEntry): void; close(): Promise<void> }`
  - `interface TransportEntry { timeMs: number; labels: Record<string, string>; line: string }`
  - `export const MAX_FIELD_CHARS = 32_768`
  - `export function truncateFields(data: Record<string, unknown>): Record<string, unknown>`: strings longer than `MAX_FIELD_CHARS` are cut, and `truncated: true` is added.
- Produces, in `src/adapters/loki.ts`:
  - `class LokiTransport implements LogTransport`, with:
    - `constructor(o: { url: string; batchSize?: number /*100*/; flushMs?: number /*1000*/; closeTimeoutMs?: number /*2000*/; fetch?: typeof fetch; warn?: (msg: string) => void })`
    - `readonly dropped: number`
- The direction stays adapters → core: `src/core` never imports from `src/adapters`.

- [ ] **Step 1: Write the failing tests** (a real `node:http` server on port 0 records the bodies received)

```ts
it('batches entries into one push grouped by label set', async () => {
  // send 3 entries: two with {level:'info'}, one with {level:'error'}; flush
  // expect one POST to /loki/api/v1/push with streams.length === 2,
  // values like [[`${timeMs}000000`, line], ...] (nanosecond strings)
});
it('flushes when batchSize is reached without waiting for the timer', async () => {});
it('counts dropped entries and warns once when Loki answers 500', async () => {
  // two failed flushes -> dropped === 2 entries total, warn called exactly once
});
it('close resolves within 2s when Loki is unreachable', async () => {
  const t = new LokiTransport({ url: 'http://127.0.0.1:9', warn: () => {} });
  t.send({ timeMs: Date.now(), labels: { level: 'info' }, line: '{}' });
  const start = performance.now();
  await t.close();
  expect(performance.now() - start).toBeLessThan(2500);
});
it('truncates long text fields', () => {
  const out = truncateFields({ answer: 'x'.repeat(40_000), n: 1 });
  expect((out.answer as string).length).toBe(MAX_FIELD_CHARS);
  expect(out.truncated).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/unit/loki.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `LokiTransport` in `src/adapters/loki.ts`**
  - Queue in memory, with a timer started on `unref()`.
  - POST JSON with `content-type: application/json` to `${url}/loki/api/v1/push`.
  - Group entries into streams by `JSON.stringify(labels)` with the keys sorted.
  - On failure, or on a status ≥ 300: add to `dropped` and call `warn` only once.
  - `close()`: clears the timer, flushes and races against `closeTimeoutMs`.
- [ ] **Step 4: Run to verify they pass.** Run: `npx vitest run tests/unit/loki.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(logging): batching Loki push transport that never blocks the app"`

### Task 4: Logger with optional transport, `with()` and `close()`; wiring in `createRag`

**Files:**

- Modify: `src/core/logger.ts`, `src/core/config.ts` (EnvSchema), `src/index.ts`, `src/core/rag.ts` (`close`)
- Test: `tests/unit/logger.test.ts` (append), `tests/unit/config.test.ts` (append)

**Interfaces:**

- Consumes: `LogTransport`, `TransportEntry`, `truncateFields` (in `src/core/logger.ts`) and `LokiTransport` (in `src/adapters/loki.ts`), all from Task 3. Only `src/index.ts` instantiates `LokiTransport`.
- Produces:
  - `Logger` gains `with?(labels: Record<string, string>): Logger` and `close?(): Promise<void>` (optional, so external loggers keep working).
  - `LoggerOptions` gains `transport?: LogTransport` and `labels?: Record<string, string>`.
  - The transport line is `JSON.stringify(truncateFields({ msg: message, ...dataAsObject }))`, after `redact()`. When `data` isn't an object, it goes as `{ msg, data }`.
  - The entry labels are `{ ...labels, level }`.
  - `SECRET_PATTERNS` gains `/glsa_[A-Za-z0-9_]{20,}/g` (Grafana service account token).
  - `EnvSchema` gains `LOKI_URL` (default `''`) and `LOG_ENV` (default `'dev'`).
  - `CreateRagConfigSchema` gains `service: z.enum(['rag-cli', 'rag-chat']).default('rag-cli')`.
  - `createRag` creates the transport only when `env.LOKI_URL` isn't empty, with labels `{ service, domain: domain.name, env: env.LOG_ENV }`.
  - `rag.close()` calls `logger.close?.()` last.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends a redacted JSON line with msg, fields and level label to the transport', () => {
  const sent: TransportEntry[] = [];
  const log = createLogger({
    secrets: ['hunter2pass'],
    labels: { service: 'rag-chat' },
    transport: { send: (e) => sent.push(e), close: async () => {} },
  });
  log.info('ask completed', { event: 'ask.completed', question: 'pw hunter2pass?' });
  expect(sent[0]!.labels).toEqual({ service: 'rag-chat', level: 'info' });
  expect(JSON.parse(sent[0]!.line)).toEqual({
    msg: 'ask completed',
    event: 'ask.completed',
    question: `pw ${REDACTED}?`,
  });
});
it('redacts secrets inside question text sent to the transport', () => {
  // question containing 'sk-or-v1-abcdefghijklmnop1234' and 'glsa_ABCDEFGHIJKLMNOPQRSTUVWX_1234'
  // expect both replaced by REDACTED in the transport line
});
it('with() adds labels and shares the transport', () => {});
it('still writes the terminal line in the existing "[level] message {json}" format', () => {});
it('parses LOKI_URL and LOG_ENV with defaults', () => {
  expect(parseEnv({}).LOKI_URL).toBe('');
  expect(parseEnv({}).LOG_ENV).toBe('dev');
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/unit/logger.test.ts tests/unit/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it as described in Interfaces.** The terminal sink stays byte for byte the same.
- [ ] **Step 4: Run.**
  - Run: `npx vitest run tests/unit/logger.test.ts tests/unit/config.test.ts tests/reuse`. Expected: PASS.
  - Run: `npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit** `git commit -m "feat(logging): optional Loki transport, labels and close() on the logger"`

### Task 5: Ask events, CLI feedback and quota

**Files:**

- Create: `src/core/events.ts`
- Modify: `src/cli/ask.ts`, `src/cli/feedback.ts`, `src/adapters/quota.ts:64,75`
- Test: `tests/unit/events.test.ts`

**Interfaces:**

- Consumes: `Logger` (Task 4), `AskResult` (`src/core/rag.ts`).
- Produces: `askEventFields(result: AskResult, extra?: { id?: string; source?: 'cli' | 'chat'; marker?: string }): Record<string, unknown>`, with:
  - `event: 'ask.completed'`, `id`, `source`, `mode`, `collection`, `intent`;
  - `status` (`answered` | `refused` | `held` | `retrieval`, same rule as `answerView` in `src/web/present.ts`), `gatePassed`, `gateBest`;
  - `groundingScore` (number or null), `supported`, `queried`, `model`, `promptTokens`, `completionTokens`;
  - `totalMs` (sum of `state.timings`), `timings`;
  - `question` (`state.question`), `answer` (`state.rawAnswer ?? state.answer ?? ''`), `citations` (ids);
  - `marker` when given.
- Feedback event: `{ event: 'feedback.saved', rating, question, cited: number }`.
- Quota: the two existing `warn` calls receive `{ event: 'quota.warning', used, warnAt, blockAt }`, with the human text kept as the message.

- [ ] **Step 1: Write the failing test** with a synthetic `AskResult` (built from `initialState` plus fields)

```ts
it('summarises an answered full-mode result with question and answer text', () => {
  const f = askEventFields(answered, { source: 'chat', id: 'x1' });
  expect(f).toMatchObject({
    event: 'ask.completed',
    status: 'answered',
    mode: 'full',
    question: 'Q?',
    supported: 2,
    queried: 1,
    groundingScore: 2 / 3,
    source: 'chat',
    id: 'x1',
  });
  expect(f.answer).toContain('## Answer');
  expect(f.totalMs).toBe(30);
});
it('marks a gate refusal as held with no model', () => {});
it('marks a retrieval-only result as retrieval', () => {});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/unit/events.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `askEventFields` and the calls**
  - `ask.ts`: `rag.logger.info('ask completed', askEventFields(result, { source: 'cli' }))` before saving `last-ask.json`.
  - `feedback.ts`: create the logger with `createLogger` from the env, so it can ship to Loki, and log `feedback.saved`.
  - `quota.ts`: add the event fields.
- [ ] **Step 4: Run.**
  - Run: `npx vitest run tests/unit/events.test.ts tests/reuse`. Expected: PASS.
  - Run: `npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit** `git commit -m "feat(logging): structured ask, feedback and quota events"`

### Task 6: Chat server instrumentation and browser error collector

**Files:**

- Modify: `src/web/server.ts`, `src/cli/chat.ts`, `web/app.js`
- Test: `tests/unit/web.test.ts` (append)

**Interfaces:**

- Consumes: `askEventFields` (Task 5), `Logger.with` (Task 4).
- Produces:
  - `ChatServerOptions` gains `logger?: Logger`. By default the server uses `rag.logger` once the library has loaded.
  - New route `POST /api/client-log`:
    - zod body `{ message: string ≤ 2000, source?: string ≤ 500, line?: int, column?: int, stack?: string ≤ 8000, page?: string ≤ 200 }` (64 KB limit already applies);
    - answers `204`;
    - global limit of 30 per rolling minute, above that `429` with `kind: 'rate-limit'`;
    - logs at `warn` through `logger.with({ service: 'rag-browser' })` with `{ event: 'browser.error', ... }`.
  - Events:
    - `http.request`: `{ event, method, route, status, ms }` on every finished response (`res.on('finish')`), at `info`, or `warn` when status ≥ 500.
    - `ask.completed`: `askEventFields(result, { source: 'chat', id })` after every `/api/ask`.
    - `ask.failed`: `{ event, kind, error, question }` at `error` when `describeError` gives status ≥ 500.
    - `feedback.saved`: on `/api/feedback`.
  - `chat.ts` calls `createRag({ service: 'rag-chat' })`.
  - `web/app.js`: listeners on `error` and `unhandledrejection` that POST to `/api/client-log` with `fetch(..., { keepalive: true })`, at most 10 per page load and silent on failure.

- [ ] **Step 1: Write the failing tests** (reuse `toyRag`; inject a logger whose transport records entries)

```ts
it('logs ask.completed with question and answer text for each /api/ask', async () => {
  // after POST /api/ask: an entry whose line parses to { event: 'ask.completed', question: 'When does the Lisbon office open?', status: 'answered' } and answer.length > 0
});
it('logs http.request with route, status and duration', async () => {});
it('accepts a client log and records it as browser.error under service rag-browser', async () => {
  // POST /api/client-log { message: 'TypeError: x is undefined', page: '/' } -> 204; entry labels.service === 'rag-browser'
});
it('rejects oversized client logs', async () => {
  // message of 2001 chars -> 400 kind 'input'
});
it('rate-limits client logs with 429', async () => {
  // 31 valid posts in a row -> the 31st returns 429; then POST /api/ask still returns 200
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/unit/web.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it as described in Interfaces.** `ChatServer.close()` must still close the RAG instance, and with it the logger and the transport flush.
- [ ] **Step 4: Run.**
  - Run: `npx vitest run tests/unit/web.test.ts`. Expected: PASS, the 9 old tests plus the new ones.
  - Run: `npm run lint`. Expected: clean.
- [ ] **Step 5: Manual check with Loki up**
  - Run: set `LOKI_URL=http://127.0.0.1:3100` in `.env`, then `npm run chat`.
  - Ask 1 question in retrieval-only mode.
  - Run: `curl -s -G http://127.0.0.1:3100/loki/api/v1/query_range --data-urlencode 'query={service="rag-chat"} | json | event="ask.completed"'`.
  - Expected: the event, with `question`.
- [ ] **Step 6: Commit** `git commit -m "feat(chat): ship request, ask and browser-error events to Loki"`

### Task 7: The two MCPs in the project

**Files:**

- Create: `.mcp.json`, `scripts/mcp-grafana.mjs`, `scripts/mcp-playwright.mjs`, `ops/playwright-mcp.config.json`, `src/cli/obs-token.ts`
- Modify: `package.json` (devDependencies `@playwright/mcp@0.0.84`, `@modelcontextprotocol/client@2.4.0`, script `obs:token`), `src/cli/scan-secrets.ts` (pattern `glsa_`)
- Test: `tests/unit/mcp-wrappers.test.ts`

**Interfaces:**

- Produces:
  - **`.mcp.json`:** `{ "mcpServers": { "grafana": { "command": "node", "args": ["scripts/mcp-grafana.mjs"] }, "playwright": { "command": "node", "args": ["scripts/mcp-playwright.mjs"] } } }`.
  - **`scripts/mcp-grafana.mjs`:**
    - Reads, with `dotenv.parse` over the file at `MCP_ENV_FILE ?? '.env'`, **only** `GRAFANA_SERVICE_ACCOUNT_TOKEN` and `GRAFANA_URL` (default `http://host.docker.internal:3000`).
    - Without a token: writes to stderr `GRAFANA_SERVICE_ACCOUNT_TOKEN is empty. Run npm run obs:token.` and exits 1.
    - With a token: `spawn('docker', ['run', '--rm', '-i', '-e', 'GRAFANA_URL', '-e', 'GRAFANA_SERVICE_ACCOUNT_TOKEN', 'grafana/mcp-grafana:<tag fixed>', '-t', 'stdio', '--disable-write', ...DISABLED], { stdio: 'inherit', env: { ...process.env, GRAFANA_URL, GRAFANA_SERVICE_ACCOUNT_TOKEN } })`. The token never goes in `args`.
    - `DISABLED` covers every category in the `--disable-*` list (Context7 `/grafana/mcp-grafana`, "Configure tool categories") **except** `search`, `datasource`, `loki`, `dashboard`, `navigation`, `query`, `examples`.
  - **`scripts/mcp-playwright.mjs`:** `spawn(process.execPath, [resolveBin('@playwright/mcp'), '--headless', '--isolated', '--output-dir', '.playwright-mcp', '--config', 'ops/playwright-mcp.config.json'], { stdio: 'inherit' })`.
  - **`ops/playwright-mcp.config.json`:** `{ "network": { "allowedOrigins": ["http://localhost:*", "http://127.0.0.1:*"] } }`. Check the name of the `--config` flag with `npx @playwright/mcp --help`.
  - **`npm run obs:token`** (`src/cli/obs-token.ts`):
    - Basic auth `admin:GRAFANA_ADMIN_PASSWORD` against `http://127.0.0.1:3000`.
    - Looks up or creates the service account `rag-mcp` (role `Viewer`) through `/api/serviceaccounts/search` and `/api/serviceaccounts`.
    - Creates a token at `/api/serviceaccounts/:id/tokens`.
    - Replaces or adds only the `GRAFANA_SERVICE_ACCOUNT_TOKEN=` line in `.env`.
    - Never prints the token. Consult the Grafana HTTP API docs (`/grafana/grafana`) before writing.

- [ ] **Step 1: Write the failing tests**

```ts
it('mcp-grafana wrapper exits 1 without a token', () => {
  const env = writeTemp('.env', 'GRAFANA_SERVICE_ACCOUNT_TOKEN=\n');
  const r = spawnSync(process.execPath, ['scripts/mcp-grafana.mjs'], {
    env: { ...process.env, MCP_ENV_FILE: env },
    encoding: 'utf8',
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('npm run obs:token');
});
it('.mcp.json starts both servers through the node wrappers', () => {
  const cfg = JSON.parse(readFileSync(projectPath('.mcp.json'), 'utf8'));
  expect(cfg.mcpServers.grafana).toEqual({ command: 'node', args: ['scripts/mcp-grafana.mjs'] });
  expect(cfg.mcpServers.playwright).toEqual({
    command: 'node',
    args: ['scripts/mcp-playwright.mjs'],
  });
});
it('the playwright config only allows loopback origins', () => {});
it('secret scan flags a Grafana service account token', () => {
  // export the scanner's pattern list or a pure function from scan-secrets and check it matches 'glsa_' + 32 chars
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/unit/mcp-wrappers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the files**, install the devDependencies with exact versions and add the script `"obs:token": "node scripts/tsx.mjs src/cli/obs-token.ts"`.
- [ ] **Step 4: Run.**
  - Run: `npx vitest run tests/unit/mcp-wrappers.test.ts`. Expected: PASS.
  - Run: `npm run obs:token`. Expected: `Saved a Viewer token for service account rag-mcp to .env`, and `.env` has the line filled in.
  - Run: `npm run scan:secrets`. Expected: `TOTAL FINDINGS: 0`.
- [ ] **Step 5: Commit** `git commit -m "feat(mcp): read-only Grafana MCP and loopback-only Playwright MCP for the project"`

### Task 8: Harness library (pure functions, tested)

**Files:**

- Create: `src/mcp-eval/types.ts`, `src/mcp-eval/metrics.ts`, `src/mcp-eval/security.ts`, `src/mcp-eval/parse.ts`, `src/mcp-eval/preflight.ts`, `src/mcp-eval/client.ts`
- Create: `ops/mcp-eval.thresholds.json`
- Test: `tests/unit/mcp-eval.test.ts`, fixtures `tests/fixtures/mcp/compose-ps.jsonl`, `tests/fixtures/mcp/snapshot.txt`

**Interfaces:**

- Produces:
  - `types.ts`:
    - `interface Measure { name: string; value: number; unit: 'ms' | 'count' | 'bytes'; limit?: number; pass?: boolean }`
    - `interface ScenarioResult { name: 'grafana' | 'playwright' | 'security'; covered: boolean; pass: boolean; measures: Measure[]; findings: string[]; notes: string[] }`
    - `interface Thresholds { grafana: { visibleMs: number; callP95Ms: number; startMs: number }; playwright: { totalMs: number; toolCalls: number; startMs: number; consoleErrors: number; apiFailures: number } }`, the same shape as `ops/mcp-eval.thresholds.json`.
  - `preflight.ts`: `uncovered(p: { lokiReady: boolean; grafanaHealthy: boolean; token: string; docker: boolean; chrome: boolean }): Record<'grafana' | 'playwright' | 'security', string | null>`, which returns the reason each scenario is left uncovered, or `null`. Grafana needs `lokiReady`, `grafanaHealthy`, a non-empty `token` and `docker`. Playwright needs `chrome`. Security needs `docker`.
  - `metrics.ts`: `summarize(ms: number[]): { count: number; p50: number; p95: number; max: number }` (nearest-rank percentiles); `measure(name, value, unit, limit?): Measure`, where `pass = value <= limit`.
  - `security.ts`:
    - `headerFindings(h: Headers): string[]`: requires CSP with `default-src 'none'` and `frame-ancestors 'none'`, `x-content-type-options: nosniff` and `referrer-policy: no-referrer`.
    - `parseComposePs(jsonl: string): { service: string; hostIp: string; hostPort: number }[]` (from `docker compose ps --format json`, field `Publishers`).
    - `loopbackFindings(ports): string[]`: any `hostIp` other than `127.0.0.1` or `::1` is a finding.
  - `parse.ts`:
    - `findRef(snapshot: string, role: string, name: string): string | null`: line `- textbox "Question" [ref=e12]` → `'e12'`.
    - `isWriteTool(name: string): boolean`: prefixes `create_`, `update_`, `delete_`, `add_`, `patch_`.
    - `lokiLines(result: CallToolResult): string[]`: from the text of `query_loki_logs`; the shape comes from the real response captured in Task 9.
  - `client.ts`:
    - `readMcpConfig(file = '.mcp.json'): Record<string, { command: string; args: string[] }>`.
    - `openMcp(name: string, spec: { command: string; args: string[] }, env?: Record<string, string>): Promise<McpSession>`, built on `Client` from `@modelcontextprotocol/client` and `StdioClientTransport` from `@modelcontextprotocol/client/stdio` (consult `/modelcontextprotocol/typescript-sdk` v2).
    - `interface McpSession { startMs: number; tools: { name: string; inputSchema: unknown }[]; calls: { tool: string; ms: number; ok: boolean }[]; call(tool: string, args: Record<string, unknown>): Promise<{ result: CallToolResult; ms: number }>; close(): Promise<void> }`.
  - `ops/mcp-eval.thresholds.json` (initial values, recalibrated in Task 9): `{ "grafana": { "visibleMs": 10000, "callP95Ms": 3000, "startMs": 30000 }, "playwright": { "totalMs": 60000, "toolCalls": 12, "startMs": 30000, "consoleErrors": 0, "apiFailures": 0 } }`.

- [ ] **Step 1: Write the failing tests**
  - `uncovered` with an empty token → `grafana` gets the reason `GRAFANA_SERVICE_ACCOUNT_TOKEN is empty (npm run obs:token)`, and the others stay `null`.
  - `summarize` (`[5,1,3,2,4]` → p50 3, p95 5, max 5), `parseComposePs` and `loopbackFindings` (fixture with one `0.0.0.0:7474` → 1 finding; all `127.0.0.1` → 0), `headerFindings` (headers from the chat server → `[]`; without CSP → finding), `findRef`, `isWriteTool` (`update_dashboard` true, `query_loki_logs` false).
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/unit/mcp-eval.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the functions**, with the signatures above.
- [ ] **Step 4: Run.** Run: `npx vitest run tests/unit/mcp-eval.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(mcp-eval): metrics, security checks, parsers and MCP client session"`

### Task 9: Scenarios, `npm run mcp:eval`, first run and documentation

**Files:**

- Create: `src/mcp-eval/grafana-scenario.ts`, `src/mcp-eval/playwright-scenario.ts`, `src/mcp-eval/security-scenario.ts`, `src/mcp-eval/report.ts`, `src/cli/mcp-eval.ts`, `tests/fixtures/mcp/query-loki-logs.json`, `tests/integration/loki.integration.test.ts`, `docs/OBSERVABILITY.md`
- Modify: `package.json` (script `mcp:eval`), `docs/dependencies.md`, `ops/mcp-eval.thresholds.json`, `docs/PRE-PUBLIC-CHECKLIST.md` (one line about `.env` with the Grafana token)
- Generated: `docs/evidence/mcp-2026-11-06.json`, `docs/evidence/mcp-2026-11-06.md`

**Interfaces:**

- Consumes: everything from Tasks 1 to 8.
- Produces:
  - `runGrafanaScenario(ctx: EvalContext): Promise<ScenarioResult>`
  - `runPlaywrightScenario(ctx: EvalContext): Promise<ScenarioResult>`
  - `runSecurityScenario(ctx: EvalContext): Promise<ScenarioResult>`
  - `interface EvalContext { chatUrl: string; marker: string; question: string; thresholds: Thresholds; mcp: Record<string, { command: string; args: string[] }> }`
  - `writeReport(results: ScenarioResult[], meta: { date: string; live: boolean; commit: string }): Promise<{ json: string; md: string }>`

**Flow of `src/cli/mcp-eval.ts`** (`npm run mcp:eval -- [--live]`):

1. **Preflight:** checks Loki `/ready`, Grafana `/api/health`, the token in `.env`, `docker version` and the presence of Chrome. `uncovered()` (Task 8) turns what's missing into `covered: false`, with the reason in `notes`.
2. **Chat server:** sets `process.env.LOG_ENV = 'eval'` and starts `startChatServer({ createRag: () => createRag({ service: 'rag-chat', llm: live ? undefined : 'mock' }), port: 0, lastAskFile: null })`. A warm-up `/api/ask` **with `retrievalOnly: true`** loads the models without calling the LLM.
   - In `--live` the harness reads the day's count in `data/usage.json` before and after.
   - The Playwright scenario repeats the same question, which hits the development cache (`data/cache/llm`).
   - If the count rose by more than 1, the run fails with the finding `live mode sent more than 1 OpenRouter request`.
3. **Marker:** `marker = 'mcp-eval-' + randomUUID()`; `question = 'When did Lewis Hamilton join Mercedes? (' + marker + ')'`.
4. **Grafana scenario:**
   - Opens the `grafana` MCP and records `startMs`, the tool count and the bytes of `JSON.stringify(tools)`. Fails if `tools.some(t => isWriteTool(t.name))`.
   - Sends the question through `/api/ask`, then calls `query_loki_logs` every 500 ms with `{ datasourceUid: 'loki', logql: '{service="rag-chat", env="eval"} |= "<marker>"', limit: 5 }` until it finds the line (limit `visibleMs`). On the first run it saves the raw response in `tests/fixtures/mcp/query-loki-logs.json`, to pin `lokiLines`.
   - Checks: the line parses with `event: 'ask.completed'`, `question` contains the marker, `answer.length > 0`, and there's no `sk-or-`, `glsa_` or the Neo4j password.
   - Then runs 10 more identical queries for `callP95Ms`.
5. **Playwright scenario:**
   - Opens the `playwright` MCP, then calls `browser_navigate { url: chatUrl }`.
   - Calls `browser_snapshot`, finds `findRef(snapshot, 'textbox', 'Question')` and calls `browser_type { ref, element: 'Question', text: question, submit: true }`.
   - Calls `browser_wait_for { text: 'Rate this answer' }`.
   - Calls `browser_console_messages { level: 'error' }`, which must be empty, and `browser_network_requests { filter: '/api/' }`, where every status must be < 400.
   - Calls `browser_close`. Measures `startMs`, `totalMs` and the number of calls. Confirm the tool names and parameters in Context7 `/microsoft/playwright-mcp` v0.0.84.
6. **Security scenario:**
   - `headerFindings` on `GET chatUrl`; `GET /..%2Fpackage.json` must give 404; the `chatUrl` host must be `127.0.0.1`.
   - `loopbackFindings(parseComposePs(docker compose ps --format json))`.
   - Without Docker the scenario is `covered: false`.
7. `writeReport`, with the output formatted by Prettier. The exit code is 1 if any covered scenario fails.

- [ ] **Step 1: Write the integration test** `tests/integration/loki.integration.test.ts`, using `describe.skipIf(!process.env.LOKI_URL)`:
  - `LokiTransport` sends a line with a marker under `{ service: 'rag-test', env: 'test' }`.
  - The test polls `/loki/api/v1/query_range` until the line appears, within 10 s.
- [ ] **Step 2: Run it.** Run: `LOKI_URL=http://127.0.0.1:3100 npx vitest run --project integration tests/integration/loki.integration.test.ts`. Expected: PASS with the stack up.
- [ ] **Step 3: Implement the scenarios, the report and the CLI** as in the flow above, with the script `"mcp:eval": "node scripts/tsx.mjs src/cli/mcp-eval.ts"`.
- [ ] **Step 4: Add the `lokiLines` test** with the captured fixture in `tests/unit/mcp-eval.test.ts`: `lokiLines(fixture)` returns 1 line containing `"event":"ask.completed"`. Run it until it passes.
- [ ] **Step 5: First real run**
  - Run: `npm run obs:up && npm run db:up && npm run mcp:eval`.
  - Expected: all 3 scenarios `covered: true`; the report saved to `docs/evidence/mcp-2026-11-06.md`.
  - If a measured value exceeds an initial limit, decide by evidence. A real failure (console error, an API status ≥ 400, an exposed port, a write tool) gets fixed in the code. A purely environmental time limit gets recalibrated in `ops/mcp-eval.thresholds.json` to 2 × the measured value, and the report records the old value, the new one and why.
- [ ] **Step 6: Documentation**
  - `docs/OBSERVABILITY.md`:
    - how to bring up the stack, create the token, open the dashboard and run `mcp:eval`;
    - that agents load `.mcp.json` when the session restarts;
    - that Google Chrome is required (or `npx playwright install chrome`);
    - the expected memory use and how to bring the stack down.
  - `docs/dependencies.md`: rows for the new packages and images, with the Context7 ids and 2026-11-05.
- [ ] **Step 7: Full gate**
  - Run: `npm run lint && npm run typecheck && npm test && npm run scan:secrets`.
  - Expected: everything green, and `TOTAL FINDINGS: 0`.
- [ ] **Step 8: Commit**

```bash
git add src/mcp-eval src/cli/mcp-eval.ts tests/fixtures/mcp tests/integration/loki.integration.test.ts tests/unit/mcp-eval.test.ts package.json ops/mcp-eval.thresholds.json docs/OBSERVABILITY.md docs/dependencies.md docs/PRE-PUBLIC-CHECKLIST.md docs/evidence/mcp-2026-11-06.json docs/evidence/mcp-2026-11-06.md
git commit -m "feat(mcp-eval): measure the Grafana and Playwright MCPs and validate the chat page"
```
