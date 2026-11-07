/**
 * Credential-shaped strings the secret scan (npm run scan:secrets) rejects in tracked files and in
 * the whole Git history. Kept in its own module so tests can check the rules without running a scan.
 */
export const SECRET_PATTERNS: [string, RegExp][] = [
  ['openrouter-key', /sk-or-v\d-[0-9a-f]{20,}/i],
  ['grafana-service-account-token', /\bglsa_[A-Za-z0-9_]{20,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['bearer-token', /Bearer\s+[A-Za-z0-9._~+/-]{24,}/],
  [
    'assigned-secret',
    /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  ],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

/** Names of the rules a line matches. */
export function secretRulesIn(line: string): string[] {
  return SECRET_PATTERNS.filter(([, re]) => re.test(line)).map(([rule]) => rule);
}
