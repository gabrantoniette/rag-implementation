import type { LogTransport, TransportEntry } from '../core/logger.js';

export interface LokiTransportOptions {
  /** Loki base URL, for example http://127.0.0.1:3100. */
  url: string;
  /** Entries per push; reaching it flushes immediately. */
  batchSize?: number;
  /** Longest wait before queued entries are pushed. */
  flushMs?: number;
  /** close() gives up on the final push after this long. */
  closeTimeoutMs?: number;
  fetch?: typeof fetch;
  /** Called once, on the first failed push (stderr by default). */
  warn?: (message: string) => void;
}

const nanoseconds = (timeMs: number) => `${Math.floor(timeMs)}000000`;

const streamKey = (labels: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))));

/**
 * Ships log lines to Loki's push API (POST /loki/api/v1/push, JSON) in batches. It never throws
 * into the application and never blocks it: a failed push drops its entries, counts them in
 * `dropped` and warns once; the timer is unref'd so it cannot keep the process alive.
 */
export class LokiTransport implements LogTransport {
  private queue: TransportEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> = Promise.resolve();
  private warned = false;
  private droppedCount = 0;
  private readonly batchSize: number;
  private readonly flushMs: number;
  private readonly closeTimeoutMs: number;
  private readonly doFetch: typeof fetch;
  private readonly warn: (message: string) => void;

  constructor(private readonly o: LokiTransportOptions) {
    this.batchSize = o.batchSize ?? 100;
    this.flushMs = o.flushMs ?? 1000;
    this.closeTimeoutMs = o.closeTimeoutMs ?? 2000;
    this.doFetch = o.fetch ?? fetch;
    this.warn = o.warn ?? ((m) => process.stderr.write(`[warn] ${m}\n`));
  }

  get dropped(): number {
    return this.droppedCount;
  }

  send(entry: TransportEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= this.batchSize) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref();
    }
  }

  /** Pushes everything queued so far; resolves when that push has finished (or failed). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue;
    this.queue = [];
    if (batch.length > 0) this.inflight = this.inflight.then(() => this.push(batch));
    return this.inflight;
  }

  async close(): Promise<void> {
    const pending = this.flush();
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.closeTimeoutMs);
        timeout.unref();
      }),
    ]);
    clearTimeout(timeout);
  }

  private async push(batch: TransportEntry[]): Promise<void> {
    const streams = new Map<
      string,
      { stream: Record<string, string>; values: [string, string][] }
    >();
    for (const e of batch) {
      const key = streamKey(e.labels);
      const s = streams.get(key) ?? { stream: e.labels, values: [] };
      s.values.push([nanoseconds(e.timeMs), e.line]);
      streams.set(key, s);
    }
    try {
      const res = await this.doFetch(`${this.o.url.replace(/\/+$/, '')}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ streams: [...streams.values()] }),
        signal: AbortSignal.timeout(this.closeTimeoutMs * 2),
      });
      if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      this.droppedCount += batch.length;
      if (!this.warned) {
        this.warned = true;
        this.warn(
          `Could not ship logs to Loki at ${this.o.url} (${(error as Error).message}); ` +
            'logs stay on the terminal. Is the stack up (npm run obs:up)?',
        );
      }
    }
  }
}
