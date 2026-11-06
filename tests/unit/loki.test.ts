import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LokiTransport } from '../../src/adapters/loki.js';
import { MAX_FIELD_CHARS, truncateFields } from '../../src/core/logger.js';

interface PushBody {
  streams: { stream: Record<string, string>; values: [string, string][] }[];
}

/** A real HTTP server that records every push body and answers with `status`. */
async function fakeLoki(status = 204) {
  const bodies: PushBody[] = [];
  const paths: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      paths.push(`${req.method} ${req.url} ${req.headers['content-type']}`);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as PushBody);
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies, paths, server };
}

let open: Server | null = null;
afterEach(async () => {
  if (open) await new Promise((r) => open!.close(r));
  open = null;
});

describe('LokiTransport', () => {
  it('batches entries into one push grouped by label set', async () => {
    const loki = await fakeLoki();
    open = loki.server;
    const t = new LokiTransport({ url: loki.url, flushMs: 60_000 });
    t.send({ timeMs: 1_700_000_000_000, labels: { level: 'info', service: 'x' }, line: 'a' });
    t.send({ timeMs: 1_700_000_000_001, labels: { service: 'x', level: 'info' }, line: 'b' });
    t.send({ timeMs: 1_700_000_000_002, labels: { level: 'error', service: 'x' }, line: 'c' });
    await t.flush();
    expect(loki.bodies).toHaveLength(1);
    expect(loki.paths[0]).toBe('POST /loki/api/v1/push application/json');
    const streams = loki.bodies[0]!.streams;
    expect(streams).toHaveLength(2);
    const info = streams.find((s) => s.stream.level === 'info')!;
    expect(info.values).toEqual([
      ['1700000000000000000', 'a'],
      ['1700000000001000000', 'b'],
    ]);
    await t.close();
  });

  it('flushes when batchSize is reached without waiting for the timer', async () => {
    const loki = await fakeLoki();
    open = loki.server;
    const t = new LokiTransport({ url: loki.url, batchSize: 2, flushMs: 60_000 });
    t.send({ timeMs: 1, labels: { level: 'info' }, line: 'a' });
    t.send({ timeMs: 2, labels: { level: 'info' }, line: 'b' });
    await expect.poll(() => loki.bodies.length, { timeout: 2000 }).toBe(1);
    await t.close();
  });

  it('counts dropped entries and warns once when Loki answers 500', async () => {
    const loki = await fakeLoki(500);
    open = loki.server;
    const warnings: string[] = [];
    const t = new LokiTransport({ url: loki.url, flushMs: 60_000, warn: (m) => warnings.push(m) });
    t.send({ timeMs: 1, labels: { level: 'info' }, line: 'a' });
    await t.flush();
    t.send({ timeMs: 2, labels: { level: 'info' }, line: 'b' });
    await t.flush();
    expect(t.dropped).toBe(2);
    expect(warnings).toHaveLength(1);
    await t.close();
  });

  it('close resolves within 2s when Loki is unreachable', async () => {
    const t = new LokiTransport({ url: 'http://127.0.0.1:9', warn: () => {} });
    t.send({ timeMs: Date.now(), labels: { level: 'info' }, line: '{}' });
    const start = performance.now();
    await t.close();
    expect(performance.now() - start).toBeLessThan(2500);
  });
});

describe('truncateFields', () => {
  it('truncates long text fields', () => {
    const out = truncateFields({ answer: 'x'.repeat(40_000), n: 1 });
    expect((out.answer as string).length).toBe(MAX_FIELD_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.n).toBe(1);
  });

  it('leaves short fields untouched and adds no flag', () => {
    expect(truncateFields({ answer: 'short', n: 1 })).toEqual({ answer: 'short', n: 1 });
  });
});
