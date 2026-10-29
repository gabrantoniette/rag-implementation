export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Patterns that look like credentials even when the exact value is unknown to the logger. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-or-(?:v\d+-)?[A-Za-z0-9_-]{16,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
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
  return out;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Exact secret values to scrub (for example the OpenRouter key and the Neo4j password). */
  secrets?: readonly string[];
  /** Where finished lines go; stderr by default so stdout stays clean for command output. */
  sink?: (line: string) => void;
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
  const emit = (level: LogLevel, message: string, data?: unknown) => {
    if (LEVELS[level] < threshold) return;
    sink(redact(`[${level}] ${message}${serialize(data)}`, secrets));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}

/** A logger that drops everything; handy for tests. */
export const silentLogger: Logger = createLogger({ sink: () => {} });
