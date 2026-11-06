import { describe, expect, it } from 'vitest';
import { REDACTED, type TransportEntry, createLogger, redact } from '../../src/core/logger.js';

describe('logger redaction', () => {
  it('scrubs the exact secret values it was given', () => {
    const lines: string[] = [];
    const log = createLogger({ secrets: ['my-neo4j-password'], sink: (l) => lines.push(l) });
    log.info('connecting', { password: 'my-neo4j-password' });
    expect(lines[0]).not.toContain('my-neo4j-password');
    expect(lines[0]).toContain(REDACTED);
  });

  it('scrubs OpenRouter-shaped keys and bearer tokens even when not configured', () => {
    const fakeKey = ['sk', 'or', 'v1', 'abcdefABCDEF0123456789abcdef'].join('-');
    const text = redact(`key=${fakeKey} header=Authorization: Bearer abc.def-ghi_123456`);
    expect(text).not.toContain(fakeKey);
    expect(text).not.toContain('abc.def-ghi_123456');
    expect(text).toContain('Bearer [REDACTED]');
  });

  it('drops messages below the configured level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
    log.info('hidden');
    log.warn('shown');
    expect(lines).toEqual(['[warn] shown']);
  });
});

describe('logger transport (Loki)', () => {
  const capture = () => {
    const sent: TransportEntry[] = [];
    let closed = 0;
    return {
      sent,
      closed: () => closed,
      transport: { send: (e: TransportEntry) => sent.push(e), close: async () => void closed++ },
    };
  };

  it('sends a redacted JSON line with msg, fields and level label to the transport', () => {
    const { sent, transport } = capture();
    const log = createLogger({
      secrets: ['hunter2pass'],
      labels: { service: 'rag-chat' },
      transport,
      sink: () => {},
    });
    log.info('ask completed', { event: 'ask.completed', question: 'pw hunter2pass?' });
    expect(sent[0]!.labels).toEqual({ service: 'rag-chat', level: 'info' });
    expect(JSON.parse(sent[0]!.line)).toEqual({
      msg: 'ask completed',
      event: 'ask.completed',
      question: `pw ${REDACTED}?`,
    });
  });

  it('redacts secrets inside question text sent to the transport', () => {
    const { sent, transport } = capture();
    const log = createLogger({ transport, sink: () => {} });
    log.info('ask completed', {
      question: 'my key sk-or-v1-abcdefghijklmnop1234 and token glsa_ABCDEFGHIJKLMNOPQRSTUVWX_1234',
    });
    expect(sent[0]!.line).not.toContain('sk-or-v1-abcdefghijklmnop1234');
    expect(sent[0]!.line).not.toContain('glsa_ABCDEFGHIJKLMNOPQRSTUVWX_1234');
    expect(sent[0]!.line.split(REDACTED)).toHaveLength(3);
  });

  it('wraps non-object data as { msg, data }', () => {
    const { sent, transport } = capture();
    createLogger({ transport, sink: () => {} }).warn('count', 3);
    expect(JSON.parse(sent[0]!.line)).toEqual({ msg: 'count', data: 3 });
  });

  it('with() adds labels and shares the transport', async () => {
    const c = capture();
    const log = createLogger({
      labels: { service: 'rag-chat' },
      transport: c.transport,
      sink: () => {},
    });
    log.with!({ service: 'rag-browser' }).warn('browser error', { event: 'browser.error' });
    expect(c.sent[0]!.labels).toEqual({ service: 'rag-browser', level: 'warn' });
    await log.close!();
    expect(c.closed()).toBe(1);
  });

  it('still writes the terminal line in the existing "[level] message {json}" format', () => {
    const lines: string[] = [];
    const { transport } = capture();
    createLogger({ transport, sink: (l) => lines.push(l) }).info('created doc', { chunks: 2 });
    expect(lines).toEqual(['[info] created doc {"chunks":2}']);
  });

  it('respects the level threshold for the transport too', () => {
    const { sent, transport } = capture();
    createLogger({ level: 'warn', transport, sink: () => {} }).info('hidden');
    expect(sent).toHaveLength(0);
  });
});
