import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { QuotaExceededError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';

interface UsageFile {
  /** UTC day (OpenRouter resets the free daily counter at UTC midnight). */
  date: string;
  count: number;
  /** Request timestamps (ms) in the last minute. */
  recent: number[];
}

export interface QuotaOptions {
  file: string;
  warnAt: number;
  blockAt: number;
  perMinute: number;
  logger: Logger;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Persisted per-day request counter (data/usage.json): warns at warnAt, blocks once blockAt requests
 * were sent today, and waits so no more than perMinute requests go out in any 60 seconds.
 */
export class QuotaGuard {
  constructor(private readonly o: QuotaOptions) {}

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  private read(): UsageFile {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (!existsSync(this.o.file)) return { date: today, count: 0, recent: [] };
    const data = JSON.parse(readFileSync(this.o.file, 'utf8')) as UsageFile;
    return data.date === today ? data : { date: today, count: 0, recent: [] };
  }

  private write(data: UsageFile) {
    mkdirSync(path.dirname(this.o.file), { recursive: true });
    writeFileSync(this.o.file, `${JSON.stringify(data)}\n`);
  }

  usedToday(): number {
    return this.read().count;
  }

  /** Call before every request that reaches OpenRouter; records it. */
  async acquire(): Promise<void> {
    let data = this.read();
    if (data.count >= this.o.blockAt) {
      throw new QuotaExceededError(
        `Daily free-model budget reached (${data.count}/${this.o.blockAt} requests today, UTC). ` +
          'The free tier allows 50 per day; try again after UTC midnight.',
      );
    }
    data.recent = data.recent.filter((t) => this.now() - t < 60_000);
    if (data.recent.length >= this.o.perMinute) {
      const waitMs = 60_000 - (this.now() - data.recent[0]!) + 50;
      this.o.logger.warn(
        `Rate limit: waiting ${Math.ceil(waitMs / 1000)} s (${this.o.perMinute}/min)`,
        {
          event: 'quota.warning',
          kind: 'per-minute',
          used: data.count,
          warnAt: this.o.warnAt,
          blockAt: this.o.blockAt,
          waitMs,
        },
      );
      await (this.o.wait ?? sleep)(waitMs);
      data = this.read();
      data.recent = data.recent.filter((t) => this.now() - t < 60_000);
    }
    data.count++;
    data.recent.push(this.now());
    this.write(data);
    if (data.count >= this.o.warnAt) {
      this.o.logger.warn(
        `Free-model usage today: ${data.count} requests (blocking at ${this.o.blockAt})`,
        {
          event: 'quota.warning',
          kind: 'daily',
          used: data.count,
          warnAt: this.o.warnAt,
          blockAt: this.o.blockAt,
        },
      );
    }
  }
}
