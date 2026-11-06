import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LokiTransport } from '../../src/adapters/loki.js';

const LOKI_URL = process.env.LOKI_URL ?? '';

/** Needs the local stack: npm run obs:up, then LOKI_URL=http://127.0.0.1:3100. */
describe.skipIf(!LOKI_URL)('Loki round trip', () => {
  it('reads back a line pushed by LokiTransport within 10 s', async () => {
    const marker = `integration-${randomUUID()}`;
    const transport = new LokiTransport({ url: LOKI_URL });
    transport.send({
      timeMs: Date.now(),
      labels: { service: 'rag-test', env: 'test', level: 'info' },
      line: JSON.stringify({ msg: 'integration test', marker }),
    });
    await transport.close();
    expect(transport.dropped).toBe(0);

    const query = new URLSearchParams({
      query: `{service="rag-test", env="test"} |= "${marker}"`,
      limit: '5',
    });
    const deadline = Date.now() + 10_000;
    let lines: string[] = [];
    while (Date.now() < deadline && lines.length === 0) {
      const res = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${query}`);
      const body = (await res.json()) as {
        data: { result: { values: [string, string][] }[] };
      };
      lines = body.data.result.flatMap((s) => s.values.map((v) => v[1]));
      if (lines.length === 0) await new Promise((r) => setTimeout(r, 500));
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ msg: 'integration test', marker });
  });
});
