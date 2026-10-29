import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, redact } from '../../src/core/logger.js';

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
