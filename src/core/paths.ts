import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the project folder. Every file this project writes lives below it. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function projectPath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, ...parts);
}

export const PATHS = {
  cache: projectPath('.cache'),
  transformersCache: projectPath('.cache', 'transformers'),
  tesseractCache: projectPath('.cache', 'tesseract'),
  framesCache: projectPath('.cache', 'frames'),
  data: projectPath('data'),
  raw: projectPath('data', 'raw'),
  llmCache: projectPath('data', 'cache', 'llm'),
  modelListCache: projectPath('data', 'cache', 'openrouter-models.json'),
  usage: projectPath('data', 'usage.json'),
  feedback: projectPath('data', 'feedback.jsonl'),
  lastAsk: projectPath('data', 'last-ask.json'),
  models: projectPath('models'),
  docs: projectPath('docs'),
  evidence: projectPath('docs', 'evidence'),
} as const;
