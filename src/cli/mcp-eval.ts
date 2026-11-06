import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { loadConfig, secretValues } from '../core/config.js';
import { PATHS, PROJECT_ROOT, projectPath } from '../core/paths.js';
import { createRag } from '../index.js';
import { readMcpConfig } from '../mcp-eval/client.js';
import type { EvalContext } from '../mcp-eval/context.js';
import { runGrafanaScenario } from '../mcp-eval/grafana-scenario.js';
import { runPlaywrightScenario } from '../mcp-eval/playwright-scenario.js';
import { uncovered } from '../mcp-eval/preflight.js';
import { writeReport } from '../mcp-eval/report.js';
import { runSecurityScenario } from '../mcp-eval/security-scenario.js';
import type { ScenarioResult, Thresholds } from '../mcp-eval/types.js';
import { startChatServer } from '../web/server.js';
import { parseArgs, runCli } from './args.js';

/**
 * npm run mcp:eval -- [--live]
 * Starts the chat server, drives the Grafana and Playwright MCPs exactly as .mcp.json starts them,
 * checks security, and writes docs/evidence/mcp-<date>.{json,md}. Answers come from the mock LLM
 * unless --live, which allows at most one OpenRouter request. Exit code 1 if a covered scenario fails.
 */
const LOKI = 'http://127.0.0.1:3100';
const GRAFANA = 'http://127.0.0.1:3000';

async function reachable(url: string, ok: (body: string) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok && ok(await res.text());
  } catch {
    return false;
  }
}

function chromeInstalled(): boolean {
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  return candidates.some((c) => existsSync(c));
}

function usedToday(): number {
  if (!existsSync(PATHS.usage)) return 0;
  const data = JSON.parse(readFileSync(PATHS.usage, 'utf8')) as { date?: string; count?: number };
  return data.date === new Date().toISOString().slice(0, 10) ? (data.count ?? 0) : 0;
}

const skipped = (name: ScenarioResult['name'], reason: string): ScenarioResult => ({
  name,
  covered: false,
  pass: false,
  measures: [],
  findings: [],
  notes: [reason],
});

runCli(async () => {
  const live = parseArgs(process.argv.slice(2), ['live']).flags.live === true;
  const env = dotenv.parse(
    existsSync(projectPath('.env')) ? readFileSync(projectPath('.env')) : '',
  );
  const lokiReady = await reachable(`${LOKI}/ready`, (b) => b.trim() === 'ready');
  const state = {
    lokiReady,
    grafanaHealthy: await reachable(`${GRAFANA}/api/health`, (b) => b.includes('"ok"')),
    token: process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || env.GRAFANA_SERVICE_ACCOUNT_TOKEN || '',
    docker: spawnSync('docker', ['version'], { encoding: 'utf8' }).status === 0,
    chrome: chromeInstalled(),
  };
  const reasons = uncovered(state);

  // Test traffic: env=eval (hidden on the dashboard); ship to Loki whenever it is up.
  process.env.LOG_ENV = 'eval';
  if (lokiReady) process.env.LOKI_URL ||= LOKI;
  const thresholds = JSON.parse(
    readFileSync(projectPath('ops', 'mcp-eval.thresholds.json'), 'utf8'),
  ) as Thresholds;
  const server = await startChatServer({
    createRag: () => createRag({ service: 'rag-chat', ...(live ? {} : { llm: 'mock' as const }) }),
    port: 0,
    lastAskFile: null,
  });
  const usageBefore = usedToday();
  const results: ScenarioResult[] = [];
  try {
    process.stdout.write(`Chat server for the evaluation: ${server.url}\nLoading the models...\n`);
    const warm = await fetch(new URL('api/ask', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'warm-up', retrievalOnly: true }),
    });
    if (!warm.ok) throw new Error(`warm-up /api/ask returned HTTP ${warm.status}`);

    const marker = `mcp-eval-${randomUUID()}`;
    const ctx: EvalContext = {
      chatUrl: server.url,
      marker,
      question: `When did Lewis Hamilton join Mercedes? (${marker})`,
      thresholds,
      mcp: readMcpConfig(),
      secrets: secretValues(loadConfig().env),
      captureLokiResponse: projectPath('tests', 'fixtures', 'mcp', 'query-loki-logs.json'),
    };
    const run = async (
      name: ScenarioResult['name'],
      fn: (c: EvalContext) => Promise<ScenarioResult>,
    ) => {
      const reason = reasons[name];
      process.stdout.write(`Scenario ${name}: ${reason ? `not covered (${reason})` : 'running'}\n`);
      results.push(reason ? skipped(name, reason) : await fn(ctx));
    };
    await run('grafana', runGrafanaScenario);
    await run('playwright', runPlaywrightScenario);
    await run('security', runSecurityScenario);
  } finally {
    await server.close();
  }

  const notes: string[] = [];
  if (thresholds.calibration)
    notes.push(
      `Limits recalibrated on ${thresholds.calibration.date}: ${thresholds.calibration.rule}.`,
      ...thresholds.calibration.notes,
    );
  if (live) {
    const sent = usedToday() - usageBefore;
    notes.push(`OpenRouter requests sent in live mode: ${sent}.`);
    if (sent > 1)
      results
        .find((r) => r.name === 'playwright')
        ?.findings.push('live mode sent more than 1 OpenRouter request');
  }
  for (const r of results)
    r.pass = r.covered && r.findings.length === 0 && r.measures.every((m) => m.pass !== false);

  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  const date = new Date().toISOString().slice(0, 10);
  const { md } = await writeReport(results, { date, live, commit, thresholds, notes });
  for (const r of results)
    process.stdout.write(
      `${r.name}: ${!r.covered ? 'NOT COVERED' : r.pass ? 'PASS' : 'FAIL'}${r.findings.length ? ` (${r.findings.join('; ')})` : ''}\n`,
    );
  process.stdout.write(`Report: ${md}\n`);
  return results.some((r) => r.covered && !r.pass) ? 1 : 0;
});
