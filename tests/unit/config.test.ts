import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_TITLE, APP_URL } from '../../src/config/app-info.js';
import {
  DEFAULT_PARAMETERS,
  applyCalibration,
  loadConfig,
  parseEnv,
  secretValues,
} from '../../src/core/config.js';
import { ConfigError } from '../../src/core/errors.js';

describe('config', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = parseEnv({ NEO4J_URI: '', DOMAIN_DIR: '  ', OPENROUTER_API_KEY: '' });
    expect(env.NEO4J_URI).toBe('bolt://localhost:7687');
    expect(env.DOMAIN_DIR).toBe('domains');
    expect(env.OPENROUTER_API_KEY).toBe('');
    expect(env.MAX_FILE_MB).toBe(50);
    expect(env.PROMPT_SINGLE_USER_MESSAGE).toBe(true);
  });

  it('rejects invalid values with a readable ConfigError', () => {
    expect(() => parseEnv({ LOG_LEVEL: 'loud' })).toThrow(ConfigError);
    expect(() => parseEnv({ MAX_FILE_MB: '-3' })).toThrow(/MAX_FILE_MB/);
  });

  it('loads the sports domain from the default folder without reading .env', () => {
    const config = loadConfig({ env: {}, applyCalibration: false });
    expect(config.domain.name).toBe('sports');
    expect(config.domain.collection).toBe('sports');
    expect(config.domain.answerPromptFile.replaceAll(path.sep, '/')).toMatch(
      /domains\/prompts\/answer\.json$/,
    );
    expect(config.domain.entityExtraction.byFormat['wikipedia-html']).toBe('wikilink');
    expect(config.parameters.retrieval.rrfK).toBe(60);
  });

  it('calibration overrides only the calibrated parameters', () => {
    const p = applyCalibration(DEFAULT_PARAMETERS, { evidenceGateThreshold: 0.42 });
    expect(p.evidenceGate.threshold).toBe(0.42);
    expect(p.retrieval.hubDegreeThreshold).toBe(DEFAULT_PARAMETERS.retrieval.hubDegreeThreshold);
    expect(DEFAULT_PARAMETERS.evidenceGate.threshold).toBe(0.5);
  });

  it('lists only non-empty secrets for redaction', () => {
    const env = parseEnv({ OPENROUTER_API_KEY: 'abc-123-secret', NEO4J_PASSWORD: '' });
    expect(secretValues(env)).toEqual(['abc-123-secret']);
  });

  it('attribution constants are non-empty and point at the repository', () => {
    expect(APP_TITLE.length).toBeGreaterThan(0);
    expect(APP_URL).toBe('https://github.com/gabrantoniette/rag-implementation');
  });

  it('treats the Grafana admin password and service account token as secrets', () => {
    const env = parseEnv({
      GRAFANA_ADMIN_PASSWORD: 'admin-pass-123456',
      GRAFANA_SERVICE_ACCOUNT_TOKEN: 'glsa_tokenvalue',
    });
    expect(secretValues(env)).toEqual(
      expect.arrayContaining(['admin-pass-123456', 'glsa_tokenvalue']),
    );
  });

  it('parses LOKI_URL and LOG_ENV with defaults', () => {
    expect(parseEnv({}).LOKI_URL).toBe('');
    expect(parseEnv({}).LOG_ENV).toBe('dev');
    expect(parseEnv({ LOKI_URL: 'http://127.0.0.1:3100', LOG_ENV: 'eval' })).toMatchObject({
      LOKI_URL: 'http://127.0.0.1:3100',
      LOG_ENV: 'eval',
    });
  });
});
