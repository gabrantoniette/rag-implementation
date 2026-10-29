import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Keep every temp file inside the project folder (see scripts/tsx.mjs for the same rule).
const root = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(root, '.cache', 'tmp');
mkdirSync(tmp, { recursive: true });
process.env.TMP = tmp;
process.env.TEMP = tmp;
process.env.TMPDIR = tmp;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/reuse/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.integration.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
