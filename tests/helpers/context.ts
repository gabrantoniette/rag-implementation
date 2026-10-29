import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PARAMETERS } from '../../src/core/config.js';
import { silentLogger } from '../../src/core/logger.js';
import { PATHS } from '../../src/core/paths.js';
import { approximateTokenCounter, type TokenCounter } from '../../src/core/tokens.js';
import type { LoaderContext } from '../../src/loaders/types.js';

export function loaderContext(overrides: Partial<LoaderContext> = {}): LoaderContext {
  return {
    tokens: approximateTokenCounter as TokenCounter,
    parameters: structuredClone(DEFAULT_PARAMETERS),
    logger: silentLogger,
    ...overrides,
  };
}

/** Writes a generated fixture under .cache/test-fixtures/<group>/ and returns its absolute path. */
export function writeFixture(group: string, name: string, content: string | Uint8Array): string {
  const dir = path.join(PATHS.cache, 'test-fixtures', group);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

export const bytes = (text: string) => new TextEncoder().encode(text);
