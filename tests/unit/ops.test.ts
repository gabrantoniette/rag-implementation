import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectPath } from '../../src/core/paths.js';

describe('docker-compose: local services stay on loopback', () => {
  it('publishes every compose port on 127.0.0.1 only', () => {
    const compose = readFileSync(projectPath('docker-compose.yml'), 'utf8');
    const ports = [...compose.matchAll(/^\s*-\s*'([^']+)'\s*$/gm)]
      .map((m) => m[1]!)
      .filter((p) => /:\d+$/.test(p));
    expect(ports.length).toBeGreaterThanOrEqual(4); // 7474, 7687, 3100, 3000
    for (const p of ports) expect(p.startsWith('127.0.0.1:')).toBe(true);
  });

  it('keeps loki and grafana behind the observability profile with memory limits', () => {
    const compose = readFileSync(projectPath('docker-compose.yml'), 'utf8');
    for (const name of ['loki', 'grafana']) {
      const block = compose.split(new RegExp(`^  ${name}:`, 'm'))[1]!.split(/^ {2}\w/m)[0]!;
      expect(block).toMatch(/profiles:\s*\[\s*'?observability'?\s*\]/);
      expect(block).toMatch(/mem_limit:/);
    }
  });

  it('sets 168h retention in the Loki config', () => {
    const loki = readFileSync(projectPath('ops', 'loki', 'loki.yaml'), 'utf8');
    expect(loki).toMatch(/retention_period:\s*168h/);
    expect(loki).toMatch(/retention_enabled:\s*true/);
    expect(loki).toMatch(/auth_enabled:\s*false/);
  });
});
