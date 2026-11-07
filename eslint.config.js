import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'node_modules/',
    '.cache/',
    '.neo4j-data/',
    '.loki-data/',
    '.grafana-data/',
    '.playwright-mcp/',
    '.superpowers/',
    'data/',
    'models/',
    'docs/',
    'coverage/',
  ]),
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
