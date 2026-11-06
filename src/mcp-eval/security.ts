/** Header rules the chat page must keep; each missing rule is one finding. */
export function headerFindings(h: Headers): string[] {
  const findings: string[] = [];
  const csp = h.get('content-security-policy') ?? '';
  if (!csp) findings.push('content-security-policy header is missing');
  else {
    if (!csp.includes("default-src 'none'"))
      findings.push("content-security-policy lacks default-src 'none'");
    if (!csp.includes("frame-ancestors 'none'"))
      findings.push("content-security-policy lacks frame-ancestors 'none'");
  }
  if (h.get('x-content-type-options') !== 'nosniff')
    findings.push('x-content-type-options is not nosniff');
  if (h.get('referrer-policy') !== 'no-referrer')
    findings.push('referrer-policy is not no-referrer');
  return findings;
}

export interface PublishedPort {
  service: string;
  hostIp: string;
  hostPort: number;
}

interface ComposeRow {
  Service?: string;
  Publishers?: { URL?: string; PublishedPort?: number }[] | null;
}

/** Published ports from `docker compose ps --format json` (one JSON object per line, or an array). */
export function parseComposePs(text: string): PublishedPort[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows: ComposeRow[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as ComposeRow[])
    : trimmed.split('\n').map((l) => JSON.parse(l) as ComposeRow);
  return rows.flatMap((row) =>
    (row.Publishers ?? [])
      .filter((p) => (p.PublishedPort ?? 0) > 0)
      .map((p) => ({
        service: row.Service ?? '?',
        hostIp: p.URL ?? '',
        hostPort: p.PublishedPort!,
      })),
  );
}

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Every port reachable from outside the machine (any host address other than loopback). */
export function loopbackFindings(ports: PublishedPort[]): string[] {
  return ports
    .filter((p) => !LOOPBACK.has(p.hostIp))
    .map((p) => `${p.service} publishes port ${p.hostPort} on ${p.hostIp || 'all interfaces'}`);
}

/**
 * The port check and what it could not cover: a failed `docker compose ps` (psOutput null) or an
 * expected service that is not running leaves part of the check unverified, and the scenario must
 * then not report the check as passed.
 */
export function portCoverage(
  psOutput: string | null,
  expected: readonly string[],
): { ports: PublishedPort[]; findings: string[]; uncovered: string[] } {
  if (psOutput === null)
    return {
      ports: [],
      findings: [],
      uncovered: ['docker compose ps failed, so no published port was checked'],
    };
  const ports = parseComposePs(psOutput);
  const running = new Set(ports.map((p) => p.service));
  return {
    ports,
    findings: loopbackFindings(ports),
    uncovered: expected
      .filter((s) => !running.has(s))
      .map((s) => `${s} is not running, so its ports were not checked`),
  };
}
