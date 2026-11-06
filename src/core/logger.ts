export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Patterns that look like credentials even when the exact value is unknown to the logger. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-or-(?:v\d+-)?[A-Za-z0-9_-]{16,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /glsa_[A-Za-z0-9_]{20,}/g, // Grafana service account token
];

export const REDACTED = '[REDACTED]';

/** Replaces every known secret value and every credential-shaped string with [REDACTED]. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(SECRET_PATTERNS[0]!, REDACTED);
  out = out.replace(SECRET_PATTERNS[1]!, `$1${REDACTED}`);
  out = out.replace(SECRET_PATTERNS[2]!, REDACTED);
  return out;
}

/** One finished log line for a remote store (Loki): labels index it, line holds the JSON. */
export interface TransportEntry {
  timeMs: number;
  labels: Record<string, string>;
  line: string;
}

/** Where log lines go besides the terminal. send() never throws and never blocks the caller. */
export interface LogTransport {
  send(entry: TransportEntry): void;
  close(): Promise<void>;
}

/** Longest text field kept in a shipped log line (characters). */
export const MAX_FIELD_CHARS = 32_768;

/** Cuts string fields longer than MAX_FIELD_CHARS and marks the record with truncated: true. */
export function truncateFields(data: Record<string, unknown>): Record<string, unknown> {
  let truncated = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > MAX_FIELD_CHARS) {
      out[key] = value.slice(0, MAX_FIELD_CHARS);
      truncated = true;
    } else out[key] = value;
  }
  if (truncated) out.truncated = true;
  return out;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** A logger with extra transport labels (for example service: rag-browser) on the same transport. */
  with?(labels: Record<string, string>): Logger;
  /** Flushes and closes the transport. Optional, so callers' own loggers keep working. */
  close?(): Promise<void>;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Exact secret values to scrub (for example the OpenRouter key and the Neo4j password). */
  secrets?: readonly string[];
  /** Where finished lines go; stderr by default so stdout stays clean for command output. */
  sink?: (line: string) => void;
  /** Optional remote store (Loki). Gets every line that passes the level threshold, as JSON. */
  transport?: LogTransport;
  /** Labels on every transport entry; the level label is added per line. */
  labels?: Record<string, string>;
}

function asRecord(data: unknown): Record<string, unknown> {
  if (data === undefined) return {};
  if (data instanceof Error) return { error: `${data.name}: ${data.message}` };
  if (typeof data === 'object' && data !== null && !Array.isArray(data))
    return data as Record<string, unknown>;
  return { data };
}

function transportLine(message: string, data: unknown): string {
  try {
    return JSON.stringify(truncateFields({ msg: message, ...asRecord(data) }));
  } catch {
    return JSON.stringify({ msg: message, data: String(data) });
  }
}

function serialize(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return ` ${data.name}: ${data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? 'info'];
  const secrets = options.secrets ?? [];
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const transport = options.transport;
  const build = (labels: Record<string, string>): Logger => {
    const emit = (level: LogLevel, message: string, data?: unknown) => {
      if (LEVELS[level] < threshold) return;
      sink(redact(`[${level}] ${message}${serialize(data)}`, secrets));
      transport?.send({
        timeMs: Date.now(),
        labels: { ...labels, level },
        line: redact(transportLine(message, data), secrets),
      });
    };
    return {
      debug: (m, d) => emit('debug', m, d),
      info: (m, d) => emit('info', m, d),
      warn: (m, d) => emit('warn', m, d),
      error: (m, d) => emit('error', m, d),
      with: (extra) => build({ ...labels, ...extra }),
      close: async () => {
        await transport?.close();
      },
    };
  };
  return build(options.labels ?? {});
}

/** A logger that drops everything; handy for tests. */
export const silentLogger: Logger = createLogger({ sink: () => {} });
