import type { CallToolResult } from '@modelcontextprotocol/client';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The [ref=...] of an element in a Playwright MCP accessibility snapshot, for example
 * `- textbox "Question" [active] [ref=e25]` gives 'e25'.
 */
export function findRef(snapshot: string, role: string, name: string): string | null {
  const re = new RegExp(`-\\s+${escape(role)}\\s+"${escape(name)}"[^\\n]*?\\[ref=([^\\]]+)\\]`);
  return re.exec(snapshot)?.[1] ?? null;
}

const WRITE_PREFIXES = ['create_', 'update_', 'delete_', 'add_', 'patch_'];

/** True for tools that change Grafana (the read-only MCP must expose none). */
export function isWriteTool(name: string): boolean {
  return WRITE_PREFIXES.some((p) => name.startsWith(p));
}

const KEY_PREFIXES = ['sk-or-', 'glsa_'];

/**
 * How many secrets appear in a shipped log line: each exact value is looked for both as is and in
 * its JSON-escaped form (a password with " or \ is escaped inside the line), plus key prefixes.
 */
export function leakedSecrets(line: string, secrets: readonly string[]): number {
  return [...KEY_PREFIXES, ...secrets].filter(
    (s) => s.length > 0 && (line.includes(s) || line.includes(JSON.stringify(s).slice(1, -1))),
  ).length;
}

/** All text blocks of a tool result, joined. */
export function resultText(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Log lines returned by the Grafana MCP's query_loki_logs. Accepts a JSON array of entries
 * (objects with a `line` field, or strings), an object with such an array, or plain text.
 */
export function lokiLines(result: CallToolResult): string[] {
  const text = resultText(result);
  const fromEntries = (entries: unknown[]) =>
    entries
      .map((e) =>
        typeof e === 'string'
          ? e
          : typeof (e as { line?: unknown }).line === 'string'
            ? (e as { line: string }).line
            : '',
      )
      .filter(Boolean);
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) return fromEntries(data);
    if (data && typeof data === 'object') {
      for (const value of Object.values(data)) if (Array.isArray(value)) return fromEntries(value);
    }
  } catch {
    // not JSON: fall through to plain text lines
  }
  return text.split('\n').filter((l) => l.trim());
}
