import { spawnSync } from 'node:child_process';
import { loadConfig } from '../core/config.js';
import { PROJECT_ROOT } from '../core/paths.js';
import { runCli } from './args.js';
import { SECRET_PATTERNS as PATTERNS } from './secret-patterns.js';

export const GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.30.1';

/** Emails that are not personal data: example domains and the commit co-author trailer. */
/** Fake values that unit tests use on purpose (only allowed inside tests/). */
const TEST_FIXTURE_VALUES = ['my-neo4j-password', 'glsa_ABCDEFGHIJKLMNOPQRSTUVWX_1234'];

const EMAIL_ALLOWLIST = [/@example\.(?:org|com|net)$/i, /^noreply@anthropic\.com$/i];

function git(args: string[]): string {
  const r = spawnSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

interface Finding {
  rule: string;
  where: string;
  sample: string;
}

const mask = (s: string) => (s.length <= 6 ? '***' : `${s.slice(0, 3)}***${s.slice(-2)}`);

function scanText(text: string, where: string, literals: string[], findings: Finding[]) {
  let file = where; // history diffs: the current file comes from the '+++ b/<path>' headers
  // Plans quote the tests they ask for, so the same fixture values are allowed there too.
  const fixture = (value: string) =>
    (file.startsWith('tests/') || file.startsWith('docs/superpowers/plans/')) &&
    TEST_FIXTURE_VALUES.some((v) => value.includes(v));
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    for (const [rule, re] of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      if (rule === 'email' && EMAIL_ALLOWLIST.some((a) => a.test(m[0]))) continue;
      if (fixture(m[0])) continue;
      findings.push({ rule, where: `${where}:${i + 1}`, sample: mask(m[0]) });
    }
    for (const lit of literals) {
      if (line.includes(lit))
        findings.push({ rule: 'env-secret-value', where: `${where}:${i + 1}`, sample: mask(lit) });
    }
  });
}

function gitleaks(): { ran: boolean; leaks: boolean; output: string } {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    return { ran: false, leaks: false, output: 'Docker not available; regex scan only.' };
  }
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${PROJECT_ROOT}:/repo`,
      GITLEAKS_IMAGE,
      'git',
      '/repo',
      '--redact',
      '--no-banner',
      '--log-level',
      'info',
    ],
    { encoding: 'utf8' },
  );
  const output = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0 && r.status !== 1)
    return { ran: false, leaks: false, output: `gitleaks failed: ${output}` };
  return { ran: true, leaks: r.status === 1, output };
}

/**
 * npm run scan:secrets: gitleaks over the whole history when Docker is available, plus a regex scan
 * of tracked files and every commit diff for key-like strings, private keys, email addresses and
 * the exact secret values from .env. Commit author metadata is listed separately.
 */
runCli(async () => {
  const env = loadConfig().env;
  const literals = [env.OPENROUTER_API_KEY, env.NEO4J_PASSWORD, env.WIKIMEDIA_CONTACT].filter(
    (s) => s.length >= 6,
  );
  const userEmail = spawnSync('git', ['config', 'user.email'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  if (userEmail) literals.push(userEmail);

  const findings: Finding[] = [];
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const file of files) {
    const content = spawnSync('git', ['show', `HEAD:${file}`], {
      cwd: PROJECT_ROOT,
      maxBuffer: 256 * 1024 * 1024,
    });
    const buf = content.stdout as Buffer;
    if (content.status !== 0 || buf.includes(0)) continue; // binary or not committed yet
    scanText(buf.toString('utf8'), file, literals, findings);
  }
  // Every diff in history (commit messages excluded; they are covered by the metadata section).
  scanText(
    git(['log', '-p', '--all', '--format=commit %h', '--no-color']),
    'history',
    literals,
    findings,
  );

  const leaks = gitleaks();
  const authors = new Set(git(['log', '--all', '--format=%ae%n%ce']).split('\n').filter(Boolean));
  const unique = new Map(findings.map((f) => [`${f.rule}|${f.where}`, f]));
  process.stdout.write(
    [
      `gitleaks (${GITLEAKS_IMAGE}): ${leaks.ran ? (leaks.leaks ? 'LEAKS FOUND' : 'no leaks found') : 'not run'}`,
      leaks.output
        ? leaks.output
            .split('\n')
            .slice(-4)
            .map((l) => `  ${l}`)
            .join('\n')
        : '',
      `regex scan: ${files.length} tracked files and full history diffs; findings: ${unique.size}`,
      ...[...unique.values()].map((f) => `  [${f.rule}] ${f.where} ${f.sample}`),
      `commit metadata (not file content): ${authors.size} distinct author/committer email(s): ${[...authors].map(mask).join(', ')}`,
      '  These come from git config user.email. Decide before publishing whether to keep them',
      '  (see docs/PRE-PUBLIC-CHECKLIST.md).',
      `TOTAL FINDINGS: ${unique.size + (leaks.leaks ? 1 : 0)}`,
      '',
    ]
      .filter((l) => l !== '')
      .join('\n') + '\n',
  );
  return unique.size > 0 || leaks.leaks ? 1 : 0;
});
