import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { projectPath } from '../core/paths.js';
import { runCli } from './args.js';
import { upsertEnvLine } from './env-file.js';

/**
 * npm run obs:token
 * Creates (or reuses) the Grafana service account "rag-mcp" with the Viewer role and saves a new
 * token for it as GRAFANA_SERVICE_ACCOUNT_TOKEN in .env, for the read-only Grafana MCP. Uses the
 * admin password from .env against the local Grafana. The token is never printed.
 */
const GRAFANA = 'http://127.0.0.1:3000';
const ACCOUNT = 'rag-mcp';
const TOKEN_DAYS = 90;

interface ServiceAccount {
  id: number;
  name: string;
  role: string;
}

runCli(async () => {
  const envFile = projectPath('.env');
  dotenv.config({ path: envFile, quiet: true });
  const password = process.env.GRAFANA_ADMIN_PASSWORD ?? '';
  if (!password) {
    process.stderr.write(
      'GRAFANA_ADMIN_PASSWORD is empty. Set it in .env and run npm run obs:up.\n',
    );
    return 1;
  }
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  const api = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${GRAFANA}${route}`, {
      method,
      headers: {
        authorization: auth,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`Grafana ${method} ${route} returned HTTP ${res.status}`);
    return (await res.json()) as T;
  };

  const found = await api<{ serviceAccounts: ServiceAccount[] }>(
    'GET',
    `/api/serviceaccounts/search?query=${ACCOUNT}`,
  );
  let account = found.serviceAccounts.find((a) => a.name === ACCOUNT);
  if (!account) {
    account = await api<ServiceAccount>('POST', '/api/serviceaccounts', {
      name: ACCOUNT,
      role: 'Viewer',
    });
  } else if (account.role !== 'Viewer') {
    process.stderr.write(
      `Service account ${ACCOUNT} has role ${account.role}, not Viewer. Fix it in Grafana first.\n`,
    );
    return 1;
  }
  const token = await api<{ key: string }>('POST', `/api/serviceaccounts/${account.id}/tokens`, {
    name: `${ACCOUNT}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    secondsToLive: TOKEN_DAYS * 24 * 3600,
  });
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  writeFileSync(envFile, upsertEnvLine(text, 'GRAFANA_SERVICE_ACCOUNT_TOKEN', token.key));
  process.stdout.write(
    `Saved a Viewer token for service account ${ACCOUNT} to .env (expires in ${TOKEN_DAYS} days).\n`,
  );
  return 0;
});
